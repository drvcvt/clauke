<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { tick } from "svelte";
  import type { ChatMessage } from "../types";
  import { getToolIcon } from "../types";
  import { marked } from "marked";
  import hljs from "highlight.js/lib/common";
  import lua from "highlight.js/lib/languages/lua";
  import ini from "highlight.js/lib/languages/ini";
  import dockerfile from "highlight.js/lib/languages/dockerfile";
  import powershell from "highlight.js/lib/languages/powershell";
  import haskell from "highlight.js/lib/languages/haskell";
  import elixir from "highlight.js/lib/languages/elixir";
  import dart from "highlight.js/lib/languages/dart";
  import nix from "highlight.js/lib/languages/nix";
  import ToolCallCard from "./ToolCallCard.svelte";

  hljs.registerLanguage("lua", lua);
  hljs.registerLanguage("toml", ini);
  hljs.registerLanguage("dockerfile", dockerfile);
  hljs.registerLanguage("powershell", powershell);
  hljs.registerLanguage("haskell", haskell);
  hljs.registerLanguage("elixir", elixir);
  hljs.registerLanguage("dart", dart);
  hljs.registerLanguage("nix", nix);

  let {
    message,
    onFork,
    onCopy,
    onEdit,
    isStreaming = false,
  }: {
    message: ChatMessage;
    onFork?: (messageId: string) => void;
    onCopy?: (messageId: string) => void;
    onEdit?: (messageId: string) => void;
    isStreaming?: boolean;
  } = $props();

  const isUser = $derived(message.role === "user");
  let copied = $state(false);

  function handleCopy() {
    if (onCopy) onCopy(message.id);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  /** For user messages, combine all text blocks into one string */
  const userText = $derived(
    message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join(""),
  );

  // Custom renderer with syntax highlighting
  const renderer = new marked.Renderer();
  renderer.code = function ({ text, lang }: { text: string; lang?: string; escaped?: boolean }) {
    let highlighted: string;
    const language = lang || "";
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(text, { language }).value;
    } else if (language) {
      // Unknown language, try auto-detect
      highlighted = hljs.highlightAuto(text).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }
    const langLabel = language ? `<span class="code-lang">${language}</span>` : "";
    return `<div class="code-block">${langLabel}<pre><code class="hljs">${highlighted}</code></pre></div>`;
  };

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  function renderMarkdown(text: string): string {
    return marked.parse(text, { async: false, renderer }) as string;
  }

  // Add copy buttons to code blocks after render
  let contentEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    // Track content changes to re-run
    const _track = message.content.length +
      message.content.filter(b => b.type === "text").map(b => (b as any).text?.length || 0).reduce((a: number, b: number) => a + b, 0);

    tick().then(() => {
      if (!contentEl) return;
      const blocks = contentEl.querySelectorAll(".code-block");
      blocks.forEach((block) => {
        if (block.querySelector(".copy-btn")) return;
        const btn = document.createElement("button");
        btn.className = "copy-btn";
        btn.textContent = "Copy";
        btn.addEventListener("click", async () => {
          const code = block.querySelector("code")?.textContent || "";
          try {
            await navigator.clipboard.writeText(code);
            btn.textContent = "Copied!";
            btn.classList.add("copied");
            setTimeout(() => {
              btn.textContent = "Copy";
              btn.classList.remove("copied");
            }, 1500);
          } catch {
            // Fallback
            const ta = document.createElement("textarea");
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            btn.textContent = "Copied!";
            setTimeout(() => (btn.textContent = "Copy"), 1500);
          }
        });
        block.appendChild(btn);
      });
    });
  });
</script>

<div class="message" class:user={isUser} class:assistant={!isUser} id={message.id} bind:this={contentEl}>
  <div class="meta">
    <span class="role">{isUser ? "you" : "claude"}</span>
    <span class="time">
      {new Date(message.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  </div>

  {#if isUser}
    {#each message.content as block}
      {#if block.type === "image"}
        <div class="user-images">
          <img src={convertFileSrc(block.path)} alt="attached" class="user-image" />
        </div>
      {/if}
    {/each}
    {#if userText}
      <div class="text">{userText}</div>
    {/if}
    {#if onEdit}
      <div class="actions user-actions">
        <button class="action-btn" onclick={() => onEdit(message.id)} title="Edit & resend">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>
    {/if}
  {:else}
    {#each message.content as block, i}
      {#if block.type === "thinking" && block.text}
        <div class="thinking-flow">{@html renderMarkdown(block.text)}</div>
      {:else if block.type === "text" && block.text}
        <div class="prose">{@html renderMarkdown(block.text)}</div>
      {:else if block.type === "tool_call"}
        {#if block.toolCall.name !== "Agent"}
          <div class="tools">
            <ToolCallCard toolCall={block.toolCall} />
          </div>
        {/if}
        {#if block.toolCall.name === "Agent" && !block.toolCall.isComplete}
          <div class="agent-indicator">
            <div class="agent-indicator-track"></div>
            <div class="agent-indicator-content">
              <span class="agent-indicator-pulse"></span>
              <span class="agent-indicator-label">agent</span>
              {#if block.toolCall.input.description}
                <span class="agent-indicator-desc">{String(block.toolCall.input.description).slice(0, 50)}</span>
              {/if}
              {#if block.toolCall.children?.length}
                {@const lastChild = block.toolCall.children[block.toolCall.children.length - 1]}
                {#if !lastChild.isComplete}
                  <span class="agent-indicator-sep">&middot;</span>
                  <span class="agent-indicator-activity">
                    <span class="agent-indicator-tool-icon">{getToolIcon(lastChild.name)}</span>
                    {lastChild.name}
                  </span>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    {/each}

    <!-- Action bar -->
    <div class="actions">
      <button class="action-btn" class:copied onclick={handleCopy} title="Copy message">
        {#if copied}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        {:else}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        {/if}
      </button>
      {#if onFork}
        <button class="action-btn" onclick={() => onFork(message.id)} title="Fork conversation from here">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
            <path d="M12 12v3" />
          </svg>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .message {
    animation: slideUp 0.35s var(--ease-out-expo);
    padding: 10px 2px;
  }

  .user {
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 12px 18px;
    margin-left: 80px;
    transition: border-color 0.3s var(--ease-out-quart);
  }

  .user:hover {
    border-color: var(--border);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .role {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
  }

  .time {
    font-size: 10.5px;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .text {
    font-size: var(--chat-font-size, 13.5px);
    line-height: 1.65;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Markdown prose styling */
  .prose {
    font-size: var(--chat-font-size, 13.5px);
    line-height: 1.7;
    color: var(--text);
    word-break: break-word;
  }

  .prose :global(p) {
    margin: 0 0 8px;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }

  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4) {
    margin: 16px 0 6px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }
  .prose :global(h1) { font-size: 18px; }
  .prose :global(h2) { font-size: 16px; }
  .prose :global(h3) { font-size: 14.5px; }
  .prose :global(h4) { font-size: 13.5px; }

  .prose :global(strong) {
    font-weight: 600;
    color: var(--text);
  }

  .prose :global(em) {
    font-style: italic;
  }

  .prose :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 1px 5px;
  }

  .prose :global(pre) {
    margin: 0;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-subtle);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    padding: 12px 16px;
    overflow-x: auto;
  }

  .prose :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
  }

  /* Code block wrapper with language label + copy button */
  .prose :global(.code-block) {
    position: relative;
    margin: 8px 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .prose :global(.code-lang) {
    display: block;
    padding: 4px 12px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-subtle);
    border-bottom: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    text-transform: lowercase;
    letter-spacing: 0.5px;
  }

  /* When no lang label, restore full border-radius on pre */
  .prose :global(.code-block:not(:has(.code-lang)) pre) {
    border-radius: var(--radius-sm);
  }

  .prose :global(.copy-btn) {
    position: absolute;
    top: 4px;
    right: 6px;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s ease;
    z-index: 2;
  }

  .prose :global(.code-block:hover .copy-btn) {
    opacity: 1;
  }

  .prose :global(.copy-btn:hover) {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--border);
  }

  .prose :global(.copy-btn.copied) {
    color: rgba(130, 220, 160, 0.9);
    border-color: rgba(130, 220, 160, 0.3);
    opacity: 1;
  }

  .prose :global(ul),
  .prose :global(ol) {
    margin: 6px 0;
    padding-left: 20px;
  }

  .prose :global(li) {
    margin: 3px 0;
  }

  .prose :global(blockquote) {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--border);
    color: var(--text-secondary);
  }

  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 12px 0;
  }

  .prose :global(a) {
    color: rgba(140, 160, 255, 0.8);
    text-decoration: none;
  }
  .prose :global(a:hover) {
    text-decoration: underline;
  }

  .prose :global(table) {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12.5px;
  }
  .prose :global(th),
  .prose :global(td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
  }
  .prose :global(th) {
    background: rgba(255, 255, 255, 0.03);
    font-weight: 500;
  }

  /* ── Action bar (copy, fork) ── */
  .actions {
    display: flex;
    gap: 2px;
    margin-top: 4px;
    opacity: 0;
    transition: opacity 0.2s var(--ease-out-quart);
  }

  .message.assistant:hover .actions,
  .message.user:hover .user-actions {
    opacity: 1;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s var(--ease-out-quart);
  }

  .action-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-glass-hover);
  }

  .action-btn.copied {
    color: rgba(130, 220, 160, 0.9);
  }

  /* ── Thinking flow text ── */
  .thinking-flow {
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-tertiary);
    opacity: 0.55;
    margin: 2px 0 6px;
    word-break: break-word;
    animation: slideUp 0.3s var(--ease-out-expo);
  }

  .thinking-flow :global(p) {
    margin: 0 0 4px;
  }
  .thinking-flow :global(p:last-child) {
    margin-bottom: 0;
  }

  .thinking-flow :global(code) {
    font-family: var(--font-mono);
    font-size: 11px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 3px;
    padding: 0 3px;
  }

  .thinking-flow :global(strong) {
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .thinking-flow :global(.code-block) {
    position: relative;
    margin: 6px 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .thinking-flow :global(.code-lang) {
    display: block;
    padding: 3px 10px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    color: var(--text-tertiary);
    opacity: 0.7;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-bottom: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    text-transform: lowercase;
    letter-spacing: 0.5px;
  }

  .thinking-flow :global(pre) {
    margin: 0;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    padding: 8px 12px;
    overflow-x: auto;
  }

  .thinking-flow :global(.code-block:not(:has(.code-lang)) pre) {
    border-radius: var(--radius-sm);
  }

  .thinking-flow :global(pre code) {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.45;
    background: none;
    border: none;
    border-radius: 0;
    padding: 0;
  }

  .thinking-flow :global(.copy-btn) {
    position: absolute;
    top: 3px;
    right: 5px;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    color: var(--text-tertiary);
    opacity: 0;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 2;
  }

  .thinking-flow :global(.code-block:hover .copy-btn) {
    opacity: 0.6;
  }

  .thinking-flow :global(.copy-btn:hover) {
    opacity: 1;
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .thinking-flow :global(.copy-btn.copied) {
    color: rgba(130, 220, 160, 0.7);
    border-color: rgba(130, 220, 160, 0.2);
    opacity: 0.8;
  }

  :global([data-theme="light"]) .thinking-flow {
    opacity: 0.45;
  }

  .tools {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0;
  }

  /* ── Agent running indicator ── */
  .agent-indicator {
    position: relative;
    margin: 2px 0 6px;
    padding: 7px 12px;
    border-radius: 6px;
    background: linear-gradient(135deg, rgba(140, 120, 220, 0.08), rgba(100, 140, 255, 0.06));
    border: 1px solid rgba(140, 120, 220, 0.15);
    overflow: hidden;
    animation: slideUp 0.35s var(--ease-out-expo);
  }

  .agent-indicator-track {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, rgba(140, 120, 220, 0.5), rgba(100, 160, 255, 0.4), transparent);
    background-size: 200% 100%;
    animation: agentTrackSlide 2s linear infinite;
  }

  @keyframes agentTrackSlide {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  .agent-indicator-content {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .agent-indicator-pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(140, 120, 220, 0.7);
    flex-shrink: 0;
    animation: agentPulse 2s ease-in-out infinite;
  }

  @keyframes agentPulse {
    0%, 100% { opacity: 0.4; box-shadow: 0 0 0 0 rgba(140, 120, 220, 0); }
    50% { opacity: 1; box-shadow: 0 0 8px 2px rgba(140, 120, 220, 0.3); }
  }

  .agent-indicator-label {
    font-weight: 500;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: rgba(160, 140, 240, 0.8);
    flex-shrink: 0;
  }

  .agent-indicator-desc {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .agent-indicator-sep {
    color: var(--text-tertiary);
    opacity: 0.4;
    flex-shrink: 0;
  }

  .agent-indicator-activity {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-tertiary);
    font-size: 10.5px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .agent-indicator-tool-icon {
    font-size: 9px;
    opacity: 0.5;
  }

  :global([data-theme="light"]) .agent-indicator {
    background: linear-gradient(135deg, rgba(100, 80, 200, 0.06), rgba(60, 100, 220, 0.04));
    border-color: rgba(100, 80, 200, 0.12);
  }

  :global([data-theme="light"]) .agent-indicator-track {
    background: linear-gradient(90deg, transparent, rgba(100, 80, 200, 0.4), rgba(60, 120, 220, 0.3), transparent);
    background-size: 200% 100%;
    animation: agentTrackSlide 2s linear infinite;
  }

  :global([data-theme="light"]) .agent-indicator-label {
    color: rgba(100, 80, 200, 0.8);
  }

  :global([data-theme="light"]) .agent-indicator-pulse {
    background: rgba(100, 80, 200, 0.6);
  }

  .user-images {
    margin: 4px 0 6px;
  }

  .user-image {
    max-width: 320px;
    max-height: 240px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    object-fit: contain;
  }
</style>
