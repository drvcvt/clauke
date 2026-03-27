<script lang="ts">
  import type { ToolCall } from "../types";
  import DiffView from "./DiffView.svelte";

  let { toolCall }: { toolCall: ToolCall } = $props();

  let expanded = $state(false);

  /** Parse MCP tool names: mcp__server__tool → { server, tool } */
  const mcpInfo = $derived.by(() => {
    const name = toolCall.name;
    if (!name.startsWith("mcp__")) return null;
    const parts = name.slice(5).split("__");
    if (parts.length >= 2) {
      return { server: parts[0], tool: parts.slice(1).join("__") };
    }
    return { server: parts[0], tool: name };
  });

  const displayName = $derived(mcpInfo ? mcpInfo.tool : toolCall.name);

  const duration = $derived(
    toolCall.endTime
      ? `${((toolCall.endTime - toolCall.startTime) / 1000).toFixed(1)}s`
      : null,
  );

  function formatSummary(tc: ToolCall): string {
    const i = tc.input;
    switch (tc.name) {
      case "Read":
        return String(i.file_path || "");
      case "Write":
        return String(i.file_path || "");
      case "Edit":
        return String(i.file_path || "");
      case "Bash":
        return String(i.command || "");
      case "Grep":
        return String(i.pattern || "");
      case "Glob":
        return String(i.pattern || "");
      case "Agent": {
        const s = String(i.prompt || i.description || "");
        return s.length > 70 ? s.slice(0, 70) + "\u2026" : s;
      }
      case "WebFetch":
        return String(i.url || "");
      case "WebSearch":
        return String(i.query || "");
      default: {
        if (i.file_path) return String(i.file_path);
        if (i.command) return String(i.command);
        if (i.pattern) return String(i.pattern);
        const keys = Object.keys(i);
        if (keys.length === 0) return "";
        const first = i[keys[0]];
        const s = typeof first === "string" ? first : JSON.stringify(first);
        return s.length > 70 ? s.slice(0, 70) + "\u2026" : s;
      }
    }
  }

  const summary = $derived(formatSummary(toolCall));

  /** Whether this tool call should show a diff view */
  const isDiffTool = $derived(toolCall.name === "Edit" || toolCall.name === "Write");

  /** Extract diff data from tool input */
  const diffData = $derived.by(() => {
    if (toolCall.name === "Edit") {
      return {
        oldText: String(toolCall.input.old_string || ""),
        newText: String(toolCall.input.new_string || ""),
        filePath: String(toolCall.input.file_path || ""),
      };
    }
    if (toolCall.name === "Write") {
      return {
        oldText: "",
        newText: String(toolCall.input.content || ""),
        filePath: String(toolCall.input.file_path || ""),
      };
    }
    return null;
  });

  /** Short preview of the result for the collapsed row */
  const resultPreview = $derived.by(() => {
    // For Edit/Write: show a line count summary instead of raw result
    if (isDiffTool && diffData && (diffData.oldText || diffData.newText)) {
      if (toolCall.name === "Edit") {
        const oldCount = diffData.oldText.split("\n").length;
        const newCount = diffData.newText.split("\n").length;
        const diff = newCount - oldCount;
        const sign = diff > 0 ? "+" : "";
        return `${oldCount} \u2192 ${newCount} lines (${sign}${diff})`;
      }
      if (toolCall.name === "Write") {
        const lines = diffData.newText.split("\n").length;
        return `${lines} lines written`;
      }
    }
    if (!toolCall.result) return "";
    const first = toolCall.result.split("\n").filter(l => l.trim()).slice(0, 1).join("");
    return first.length > 80 ? first.slice(0, 80) + "\u2026" : first;
  });

  function truncateResult(text: string, lines: number): { text: string; truncated: boolean } {
    const allLines = text.split("\n");
    if (allLines.length <= lines) return { text, truncated: false };
    return { text: allLines.slice(0, lines).join("\n"), truncated: true };
  }
</script>

<div
  class="tool"
  class:complete={toolCall.isComplete}
  class:has-error={toolCall.isError}
  role="button"
  tabindex="0"
  onclick={() => (expanded = !expanded)}
  onkeydown={(e) => e.key === "Enter" && (expanded = !expanded)}
>
  <div class="row">
    {#if !toolCall.isComplete}
      <span class="pulse-dot"></span>
    {:else}
      <span class="status-dot" class:error={toolCall.isError}></span>
    {/if}
    {#if mcpInfo}
      <span class="mcp-server">{mcpInfo.server}</span>
      <span class="mcp-sep">&rsaquo;</span>
    {/if}
    <span class="name">{displayName}</span>
    {#if summary}
      <span class="summary">{summary}</span>
    {/if}
    <span class="right">
      {#if duration}
        <span class="dur">{duration}</span>
      {/if}
      <span class="expand-hint" class:open={expanded}></span>
    </span>
  </div>

  {#if toolCall.isComplete && resultPreview && !expanded}
    <div class="result-preview">{resultPreview}</div>
  {/if}

  {#if expanded}
    <div class="body">
      {#if isDiffTool && diffData && (diffData.oldText || diffData.newText)}
        <DiffView
          oldText={diffData.oldText}
          newText={diffData.newText}
          filePath={diffData.filePath}
        />
        {#if toolCall.result && toolCall.isError}
          <pre class="block result error-result">{toolCall.result}</pre>
        {/if}
      {:else}
        {#if Object.keys(toolCall.input).length > 0}
          <pre class="block">{JSON.stringify(toolCall.input, null, 2)}</pre>
        {/if}
        {#if toolCall.result}
          {@const r = truncateResult(toolCall.result, 200)}
          <pre class="block result">{r.text}{#if r.truncated}<span class="fade-out"></span>{/if}</pre>
        {:else if toolCall.isComplete}
          <div class="no-result">no output</div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    cursor: pointer;
    border-radius: 6px;
    transition: background 0.2s var(--ease-out-quart);
    padding: 0 4px;
    margin: 1px -4px;
    animation: fadeIn 0.25s var(--ease-out-expo);
  }

  .tool:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .pulse-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
    animation: glow 2s ease-in-out infinite;
  }

  @keyframes glow {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.35);
    flex-shrink: 0;
    animation: fadeIn 0.3s var(--ease-out-expo);
  }

  .status-dot.error {
    background: #f87171;
    box-shadow: 0 0 6px 2px rgba(248, 113, 113, 0.4);
  }

  .mcp-server {
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 500;
    flex-shrink: 0;
    opacity: 0.5;
    letter-spacing: 0.3px;
    font-family: var(--font-mono);
  }

  .mcp-sep {
    color: var(--text-tertiary);
    font-size: 10px;
    opacity: 0.3;
  }

  .name {
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 500;
    flex-shrink: 0;
    letter-spacing: 0.3px;
  }

  .summary {
    color: var(--text-secondary);
    font-size: 11.5px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .dur {
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.7;
  }

  .result-preview {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-tertiary);
    padding: 0 4px 4px 17px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.7;
    animation: fadeIn 0.3s var(--ease-out-expo);
  }

  .expand-hint {
    width: 12px;
    height: 12px;
    position: relative;
    opacity: 0;
    transition: opacity 0.2s var(--ease-out-quart), transform 0.3s var(--ease-out-expo);
  }

  .tool:hover .expand-hint {
    opacity: 0.3;
  }

  .expand-hint::before,
  .expand-hint::after {
    content: "";
    position: absolute;
    background: currentColor;
    color: var(--text-tertiary);
    border-radius: 1px;
  }

  /* horizontal line */
  .expand-hint::before {
    top: 50%;
    left: 2px;
    right: 2px;
    height: 1.2px;
    transform: translateY(-50%);
  }

  /* vertical line (collapses when open) */
  .expand-hint::after {
    left: 50%;
    top: 2px;
    bottom: 2px;
    width: 1.2px;
    transform: translateX(-50%);
    transition: transform 0.2s ease, opacity 0.2s ease;
  }

  .expand-hint.open::after {
    opacity: 0;
    transform: translateX(-50%) scaleY(0);
  }

  /* expanded body */
  .body {
    padding: 2px 0 6px 0;
    animation: bodyExpand 0.3s var(--ease-out-expo);
    transform-origin: top;
  }

  @keyframes bodyExpand {
    from {
      opacity: 0;
      transform: scaleY(0.9) translateY(-4px);
      max-height: 0;
    }
    to {
      opacity: 1;
      transform: scaleY(1) translateY(0);
      max-height: 500px;
    }
  }

  .block {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    max-height: 600px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    position: relative;
  }

  .block + .block {
    margin-top: 4px;
  }

  .block.result {
    color: var(--text-tertiary);
    font-size: 10.5px;
  }

  .block.error-result {
    color: rgba(248, 113, 113, 0.8);
    margin-top: 4px;
  }

  .no-result {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-tertiary);
    opacity: 0.5;
    padding: 4px 12px;
    font-style: italic;
  }

  .fade-out {
    display: block;
    height: 24px;
    background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.15));
    margin: 0 -12px -8px;
    pointer-events: none;
  }
</style>
