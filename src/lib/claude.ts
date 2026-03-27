/**
 * Claude event parser — transforms raw stream-json events into UI-friendly structures.
 *
 * Claude Code's stream-json format emits newline-delimited JSON.
 * This module normalizes different event shapes into a consistent format.
 */

import type { ChatMessage, ToolCall, ContentBlock, ClaudeEvent, TokenUsage } from "./types";

let idCounter = 0;
function nextId(): string {
  return `msg-${++idCounter}-${Date.now()}`;
}

/**
 * Per-tab stack of currently-running Agent tool call IDs.
 * Keyed by tab_id so that multi-tab usage doesn't cross-contaminate.
 * When an Agent tool_use starts, its ID is pushed onto the tab's stack.
 * When its tool_result arrives, the ID is popped.
 * Any tool calls created while the stack is non-empty are added
 * as children of the top-most Agent instead of as top-level content blocks.
 */
const agentStacks = new Map<string, string[]>();

function getAgentStack(tabId: string): string[] {
  let stack = agentStacks.get(tabId);
  if (!stack) {
    stack = [];
    agentStacks.set(tabId, stack);
  }
  return stack;
}

/** Clean up internal state for a closed tab to prevent memory leaks. */
export function cleanupTabState(tabId: string): void {
  agentStacks.delete(tabId);
}

export interface EventResult {
  modified: boolean;
  sessionId?: string;
  usage?: TokenUsage;
  /** Last input tokens — approximates current context fill */
  contextTokens?: number;
  /** True when a context compaction was detected */
  compacted?: boolean;
  /** If set, the CLI is waiting for a permission decision */
  permissionRequest?: {
    toolName: string;
    toolInput: Record<string, unknown>;
    description?: string;
  };
  /** True when the current turn is complete (final result event) */
  turnComplete?: boolean;
  /** Authoritative cost from CLI (total_cost_usd on result event) */
  totalCostUsd?: number;
}

/**
 * Process a raw Claude event and update the messages array in place.
 * Returns an EventResult with session_id and usage if present.
 */
export function processClaudeEvent(
  event: ClaudeEvent,
  messages: ChatMessage[],
  tabId?: string,
): EventResult {
  const type = event.type;
  const activeAgentStack = getAgentStack(tabId || (event.tab_id as string) || "default");

  // Debug: log every event so we can trace what the CLI actually sends
  if (import.meta.env.DEV) {
    console.debug("[clauke] event:", type, event);
  }

  // Get or create the current assistant message
  function getAssistantMessage(): ChatMessage {
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant") {
      return last;
    }
    const msg: ChatMessage = {
      id: nextId(),
      role: "assistant",
      content: [],
      timestamp: Date.now(),
    };
    messages.push(msg);
    return msg;
  }

  /** Get (or create) the last text block to append to */
  function getLastTextBlock(msg: ChatMessage): ContentBlock & { type: "text" } {
    const last = msg.content[msg.content.length - 1];
    if (last && last.type === "text") {
      return last;
    }
    const block: ContentBlock = { type: "text", text: "" };
    msg.content.push(block);
    return block as ContentBlock & { type: "text" };
  }

  /** Get (or create) the last thinking block to append to */
  function getLastThinkingBlock(msg: ChatMessage): ContentBlock & { type: "thinking" } {
    const last = msg.content[msg.content.length - 1];
    if (last && last.type === "thinking") {
      return last;
    }
    const block: ContentBlock = { type: "thinking", text: "" };
    msg.content.push(block);
    return block as ContentBlock & { type: "thinking" };
  }

  /**
   * Append text to the active Agent's thinking pseudo-child.
   * Returns true if text was captured, false if no Agent is active.
   */
  function appendAgentThinking(text: string): boolean {
    if (!text || activeAgentStack.length === 0) return false;
    const parentId = activeAgentStack[activeAgentStack.length - 1];
    const parent = findToolCallGlobal(parentId);
    if (!parent) return false;
    if (!parent.children) parent.children = [];

    const lastChild = parent.children[parent.children.length - 1];
    if (lastChild && lastChild.name === "Thinking" && !lastChild.isComplete) {
      lastChild.result = (lastChild.result || "") + text;
    } else {
      parent.children.push({
        id: nextId(),
        name: "Thinking",
        input: {},
        result: text,
        isComplete: false,
        startTime: Date.now(),
      });
    }
    return true;
  }

  /** Check if a tool name refers to an Agent (case-insensitive) */
  function isAgentTool(name: string): boolean {
    return name.trim().toLowerCase() === "agent";
  }

  /**
   * Add a tool call — either as a top-level content block or as a child
   * of the currently-active Agent (if one is running).
   */
  function addToolCall(msg: ChatMessage, tc: ToolCall): void {
    // Normalize Agent name to canonical casing
    if (isAgentTool(tc.name) && tc.name !== "Agent") {
      tc.name = "Agent";
    }

    // Dedup: if an Agent with this ID already exists, skip it.
    // This prevents duplicates when the CLI sends both streaming events
    // AND a full message with the same tool_use blocks.
    if (tc.name === "Agent" && tc.id && findToolCallGlobal(tc.id)) {
      if (import.meta.env.DEV) {
        console.debug("[clauke:agent] dedup — Agent", tc.id, "already exists, skipping");
      }
      return;
    }

    // If there's an active Agent and this isn't an Agent itself,
    // nest it as a child of the most recent active Agent.
    if (activeAgentStack.length > 0 && tc.name !== "Agent") {
      const parentId = activeAgentStack[activeAgentStack.length - 1];
      const parent = findToolCallGlobal(parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        // Close any open Thinking pseudo-child
        const lastChild = parent.children[parent.children.length - 1];
        if (lastChild?.name === "Thinking" && !lastChild.isComplete) {
          lastChild.isComplete = true;
          lastChild.endTime = Date.now();
        }
        parent.children.push(tc);
        return;
      }
    }
    msg.content.push({ type: "tool_call", toolCall: tc });
    // If this is an Agent tool, push onto the stack
    if (tc.name === "Agent") {
      activeAgentStack.push(tc.id);
      if (import.meta.env.DEV) {
        console.debug("[clauke:agent] PUSH", tc.id, "desc:", tc.input.description || tc.input.prompt || "(no desc)", "| stack size:", activeAgentStack.length);
      }
    }
  }

  /** Find a tool call by ID across all content blocks (including agent children) */
  function findToolCall(msg: ChatMessage, id: string): ToolCall | undefined {
    for (const block of msg.content) {
      if (block.type === "tool_call") {
        if (block.toolCall.id === id) return block.toolCall;
        // Search inside agent children
        if (block.toolCall.children) {
          for (const child of block.toolCall.children) {
            if (child.id === id) return child;
          }
        }
      }
    }
    return undefined;
  }

  /** Find a tool call by ID across ALL messages (including agent children) */
  function findToolCallGlobal(id: string): ToolCall | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        const tc = findToolCall(messages[i], id);
        if (tc) return tc;
      }
    }
    return undefined;
  }

  /** Get the last (most recently started) tool call, including agent children */
  function getLastToolCall(msg: ChatMessage): ToolCall | undefined {
    for (let i = msg.content.length - 1; i >= 0; i--) {
      const block = msg.content[i];
      if (block.type === "tool_call") {
        // If this Agent has children, the last incomplete child is the most recent tool
        if (block.toolCall.children?.length) {
          const lastChild = block.toolCall.children[block.toolCall.children.length - 1];
          if (!lastChild.isComplete) return lastChild;
        }
        return block.toolCall;
      }
    }
    return undefined;
  }

  /**
   * Mark all incomplete tool calls in a message as complete.
   * Called when we see evidence that the tool has finished (new content starts,
   * or explicit tool_result).
   *
   * IMPORTANT: Agents on the activeAgentStack are SKIPPED — they're still
   * waiting for their tool_result and will have more children arriving.
   * Marking them complete here would break the UI (show "done" prematurely)
   * and leave the stack dirty.
   */
  function markPendingToolsComplete(msg: ChatMessage): void {
    for (const block of msg.content) {
      if (block.type === "tool_call" && !block.toolCall.isComplete) {
        // Don't mark Agents that are still on the active stack — they're running
        if (block.toolCall.name === "Agent" && activeAgentStack.includes(block.toolCall.id)) {
          // Mark incomplete tool children (not Thinking — those close via addToolCall)
          if (block.toolCall.children) {
            for (const child of block.toolCall.children) {
              if (!child.isComplete && child.name !== "Thinking") {
                child.isComplete = true;
                child.inferredComplete = true;
                if (!child.endTime) child.endTime = Date.now();
              }
            }
          }
          continue;
        }
        block.toolCall.isComplete = true;
        if (!block.toolCall.endTime) block.toolCall.endTime = Date.now();
        // Also mark children and pop from agent stack
        if (block.toolCall.children) {
          for (const child of block.toolCall.children) {
            if (!child.isComplete) {
              child.isComplete = true;
              if (child.name !== "Thinking") child.inferredComplete = true;
              if (!child.endTime) child.endTime = Date.now();
            }
          }
        }
        if (block.toolCall.name === "Agent") {
          const idx = activeAgentStack.indexOf(block.toolCall.id);
          if (idx !== -1) activeAgentStack.splice(idx, 1);
        }
      }
    }
  }

  const MODIFIED: EventResult = { modified: true };
  const UNMODIFIED: EventResult = { modified: false };

  /** Process a tool result event (shared logic) */
  function handleToolResult(toolUseId: string, rawContent: unknown, isError?: boolean): EventResult {
    const msg = getAssistantMessage();
    let resultText = "";
    if (typeof rawContent === "string") {
      resultText = rawContent;
    } else if (Array.isArray(rawContent)) {
      resultText = (rawContent as Array<Record<string, unknown>>)
        .map((c) => (c.text as string) || JSON.stringify(c))
        .join("\n");
    } else if (rawContent && typeof rawContent === "object") {
      const obj = rawContent as Record<string, unknown>;
      resultText = (obj.text as string) || JSON.stringify(rawContent);
    }

    let tc: ToolCall | undefined;
    if (toolUseId) {
      tc = findToolCallGlobal(toolUseId);
    }
    if (!tc) {
      // Fallback: mark the last incomplete tool call (heuristic — may misattribute)
      const lastTc = getLastToolCall(msg);
      if (lastTc && !lastTc.isComplete) {
        console.warn("[clauke] Tool result has no matching ID, falling back to last incomplete tool:", lastTc.name, lastTc.id, "| result event had id:", toolUseId || "(none)");
        tc = lastTc;
      }
    }

    if (tc) {
      tc.result = resultText;
      tc.isComplete = true;
      tc.isError = isError || false;
      tc.endTime = Date.now();
      // If this is an Agent completing, mark all its children as complete and pop from stack
      if (tc.name === "Agent") {
        if (tc.children) {
          for (const child of tc.children) {
            if (!child.isComplete) {
              child.isComplete = true;
              if (child.name !== "Thinking") child.inferredComplete = true;
              if (!child.endTime) child.endTime = Date.now();
            }
          }
        }
        const idx = activeAgentStack.indexOf(tc.id);
        if (idx !== -1) activeAgentStack.splice(idx, 1);
        if (import.meta.env.DEV) {
          console.debug("[clauke:agent] POP", tc.id, "| children:", tc.children?.length ?? 0, "| stack size:", activeAgentStack.length, "| error:", isError);
        }
      }
    }
    return MODIFIED;
  }

  /** Extract usage data from an event.
   *  Checks top-level ev.usage (result events) and ev.message.usage (assistant events). */
  function extractUsage(ev: ClaudeEvent): TokenUsage | undefined {
    // Try top-level usage (result events)
    let usage = ev.usage as Record<string, unknown> | undefined;
    // Try message.usage (assistant events carry per-call usage here)
    if (!usage) {
      const message = ev.message as Record<string, unknown> | undefined;
      usage = message?.usage as Record<string, unknown> | undefined;
    }
    if (!usage) return undefined;
    const input = (usage.input_tokens as number) || 0;
    const output = (usage.output_tokens as number) || 0;
    const cacheRead = (usage.cache_read_input_tokens as number) || (usage.cache_read_tokens as number) || 0;
    const cacheWrite = (usage.cache_creation_input_tokens as number) || (usage.cache_creation_tokens as number) || 0;
    if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return undefined;
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheWrite,
    };
  }

  switch (type) {
    // System init or compact notification
    case "system": {
      // Detect auto-compact events from the CLI
      const subtype = event.subtype as string | undefined;
      if (subtype === "compact" || subtype === "auto_compact") {
        // Insert a system message showing compaction happened
        const sysMsg: ChatMessage = {
          id: nextId(),
          role: "system",
          content: [{ type: "text", text: "context compacted" }],
          timestamp: Date.now(),
        };
        messages.push(sysMsg);
        return { modified: true, compacted: true };
      }
      return UNMODIFIED;
    }

    // Assistant text content
    case "assistant": {
      const msg = getAssistantMessage();
      const message = event.message as Record<string, unknown> | undefined;
      if (!message) return UNMODIFIED;

      if (message.type === "thinking") {
        const text = (message.thinking as string) || (message.text as string) || "";
        if (!appendAgentThinking(text)) {
          getLastThinkingBlock(msg).text += text;
        }
      } else if (message.type === "text") {
        markPendingToolsComplete(msg);
        const text = (message.text as string) || "";
        if (!appendAgentThinking(text)) {
          getLastTextBlock(msg).text += text;
        }
      } else if (message.type === "tool_use") {
        // New tool_use → any previously pending tool calls have finished
        markPendingToolsComplete(msg);
        const tc: ToolCall = {
          id: (message.id as string) || nextId(),
          name: (message.name as string) || "unknown",
          input: (message.input as Record<string, unknown>) || {},
          isComplete: false,
          startTime: Date.now(),
        };
        addToolCall(msg, tc);
      } else if (message.content) {
        // Full message format: {"role":"assistant","content":[...]}
        // Mark any pending tools from previous assistant turn
        markPendingToolsComplete(msg);
        const content = message.content as Array<Record<string, unknown>>;
        if (Array.isArray(content)) {
          if (import.meta.env.DEV) {
            const agentBlocks = content.filter((b) => b.type === "tool_use" && (b.name as string)?.trim?.().toLowerCase() === "agent");
            if (agentBlocks.length > 0) {
              console.debug("[clauke:agent] Full message contains", agentBlocks.length, "Agent tool_use blocks out of", content.length, "total blocks");
            }
          }
          for (const block of content) {
            if (block.type === "thinking") {
              getLastThinkingBlock(msg).text += (block.thinking as string) || (block.text as string) || "";
            } else if (block.type === "text") {
              // If the last content is already text with content, start a new block
              const lastContent = msg.content[msg.content.length - 1];
              if (lastContent && lastContent.type === "text" && lastContent.text) {
                msg.content.push({ type: "text", text: "" });
              }
              getLastTextBlock(msg).text += (block.text as string) || "";
            } else if (block.type === "tool_use") {
              const tc: ToolCall = {
                id: (block.id as string) || nextId(),
                name: (block.name as string) || "unknown",
                input: (block.input as Record<string, unknown>) || {},
                isComplete: false,
                startTime: Date.now(),
              };
              addToolCall(msg, tc);
            } else if (block.type === "tool_result") {
              // Tool result embedded in content array
              handleToolResult(
                block.tool_use_id as string,
                block.content,
                block.is_error as boolean | undefined,
              );
            }
          }
        }
      }
      // Extract per-call usage from assistant events for live display
      const assistantUsage = extractUsage(event);
      if (assistantUsage) {
        return { modified: true, usage: assistantUsage };
      }
      return MODIFIED;
    }

    // Content block events (streaming API format)
    case "content_block_start": {
      const msg = getAssistantMessage();
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "thinking") {
        // Only create main-message thinking block when not inside an Agent
        if (activeAgentStack.length === 0) {
          const lastContent = msg.content[msg.content.length - 1];
          if (lastContent && lastContent.type === "thinking" && lastContent.text) {
            msg.content.push({ type: "thinking", text: "" });
          }
        }
      } else if (block?.type === "tool_use") {
        // New tool starting → mark any previous pending tools as complete
        markPendingToolsComplete(msg);
        const tc: ToolCall = {
          id: (block.id as string) || nextId(),
          name: (block.name as string) || "unknown",
          input: {},
          isComplete: false,
          startTime: Date.now(),
        };
        addToolCall(msg, tc);
      } else if (block?.type === "text") {
        markPendingToolsComplete(msg);
        // Only create main-message text block when not inside an Agent
        if (activeAgentStack.length === 0) {
          const lastContent = msg.content[msg.content.length - 1];
          if (lastContent && lastContent.type === "text" && lastContent.text) {
            msg.content.push({ type: "text", text: "" });
          }
        }
      }
      return MODIFIED;
    }

    case "content_block_delta": {
      const msg = getAssistantMessage();
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "thinking_delta") {
        const text = (delta.thinking as string) || "";
        if (!appendAgentThinking(text)) {
          getLastThinkingBlock(msg).text += text;
        }
      } else if (delta?.type === "text_delta") {
        const text = (delta.text as string) || "";
        if (activeAgentStack.length > 0) {
          // Inside an Agent — capture as agent thinking
          appendAgentThinking(text);
        } else {
          // Normal text — mark pending tools and append
          const lastTc = getLastToolCall(msg);
          if (lastTc && !lastTc.isComplete) {
            const lastBlock = msg.content[msg.content.length - 1];
            if (!lastBlock || lastBlock.type !== "tool_call") {
              markPendingToolsComplete(msg);
            }
          }
          getLastTextBlock(msg).text += text;
        }
      } else if (delta?.type === "input_json_delta") {
        // Tool input streaming — append to last tool call's raw input
        const lastTc = getLastToolCall(msg);
        if (lastTc) {
          const partial = delta.partial_json as string;
          if (partial) {
            if (!lastTc.input.__raw) lastTc.input.__raw = "";
            lastTc.input.__raw += partial;
          }
        }
      }
      return MODIFIED;
    }

    case "content_block_stop": {
      const msg = getAssistantMessage();
      const lastTc = getLastToolCall(msg);
      if (lastTc?.input.__raw) {
        try {
          const parsed = JSON.parse(lastTc.input.__raw as string);
          Object.assign(lastTc.input, parsed);
        } catch (e) {
          console.warn("[clauke] Failed to parse streamed tool input JSON for", lastTc.name, "— input may be incomplete. Raw:", String(lastTc.input.__raw).slice(0, 200), e);
        }
        delete lastTc.input.__raw;
      }
      return MODIFIED;
    }

    // User message — contains tool_result blocks from CLI tool execution
    case "user": {
      const userMsg = event.message as Record<string, unknown> | undefined;
      if (!userMsg) return UNMODIFIED;
      const content = userMsg.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return UNMODIFIED;
      let didModify = false;
      for (const block of content) {
        if (block.type === "tool_result") {
          handleToolResult(
            block.tool_use_id as string,
            block.content,
            block.is_error as boolean | undefined,
          );
          didModify = true;
        }
      }
      return didModify ? MODIFIED : UNMODIFIED;
    }

    // Tool result — explicit type
    case "tool_result":
    case "tool": {
      return handleToolResult(
        (event.tool_use_id as string) || (event.id as string),
        event.content ?? event.output,
        event.is_error as boolean | undefined,
      );
    }

    // Result event — can be either tool_result or final completion
    case "result": {
      const subtype = event.subtype as string | undefined;
      const sessionId = event.session_id as string | undefined;

      // Tool result disguised as "result" event — match broadly.
      // Don't return usage here — the final result event has the aggregated total.
      if (
        subtype === "tool_result" ||
        subtype === "tool_use_result" ||
        event.tool_use_id
      ) {
        handleToolResult(
          event.tool_use_id as string,
          event.content ?? event.output,
          event.is_error as boolean | undefined,
        );
        return { modified: true, sessionId };
      }

      // Final completion — turn is over, all agents must be done.
      // This event carries the authoritative aggregated usage for the entire turn.
      const usage = extractUsage(event);
      const totalCostUsd = (event.total_cost_usd as number) || undefined;

      const msg = getAssistantMessage();
      const resultText =
        (event.result as string) || (event.text as string) || "";
      const hasText = msg.content.some(
        (b) => b.type === "text" && b.text.trim(),
      );
      if (resultText && !hasText) {
        // Append instead of overwrite — streaming deltas may have added whitespace-only content
        const textBlock = getLastTextBlock(msg);
        textBlock.text = textBlock.text.trimEnd() ? textBlock.text + resultText : resultText;
      }
      // Clear agent stack — the turn is finished, nothing is still running
      if (import.meta.env.DEV && activeAgentStack.length > 0) {
        console.debug("[clauke:agent] TURN COMPLETE — clearing stack with", activeAgentStack.length, "agents still tracked:", [...activeAgentStack]);
      }
      activeAgentStack.length = 0;
      // Mark any remaining incomplete tool calls (and their children) as done
      for (const block of msg.content) {
        if (block.type === "tool_call" && !block.toolCall.isComplete) {
          block.toolCall.isComplete = true;
          block.toolCall.inferredComplete = true;
          if (!block.toolCall.endTime) block.toolCall.endTime = Date.now();
        }
        if (block.type === "tool_call" && block.toolCall.children) {
          for (const child of block.toolCall.children) {
            if (!child.isComplete) {
              child.isComplete = true;
              if (child.name !== "Thinking") child.inferredComplete = true;
              if (!child.endTime) child.endTime = Date.now();
            }
          }
        }
      }
      return { modified: true, sessionId, usage, totalCostUsd, turnComplete: true };
    }

    // Error
    case "error": {
      const msg = getAssistantMessage();
      const errObj = event.error as Record<string, unknown> | undefined;
      const errorText =
        (event.text as string) ||
        (errObj?.message as string) ||
        (typeof event.message === "string" ? event.message : null) ||
        "Unknown error";
      getLastTextBlock(msg).text += `\n\n**Error:** ${errorText}`;
      return MODIFIED;
    }

    // Raw text (non-JSON output)
    case "raw": {
      const msg = getAssistantMessage();
      getLastTextBlock(msg).text += (event.text as string) || "";
      return MODIFIED;
    }

    // Permission request — the CLI is waiting for approval on stdin
    case "permission_request":
    case "tool_use_permission": {
      const toolName = (event.tool_name as string) || (event.tool as string) || "unknown";
      const toolInput = (event.input as Record<string, unknown>) || (event.tool_input as Record<string, unknown>) || {};
      const description = (event.description as string) || (event.message as string) || undefined;
      return {
        modified: true,
        permissionRequest: { toolName, toolInput, description },
      };
    }

    default:
      console.debug("[clauke] unhandled event type:", type, event);
      return UNMODIFIED;
  }
}
