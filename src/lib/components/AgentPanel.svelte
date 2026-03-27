<script lang="ts">
  import type { ToolCall } from "../types";
  import { getToolIcon } from "../types";
  import { tick } from "svelte";

  let {
    agents,
    open,
    hidden = false,
    onToggle,
  }: {
    agents: ToolCall[];
    open: boolean;
    hidden?: boolean;
    onToggle: () => void;
  } = $props();

  let expandedId = $state<string | null>(null);
  let expandedChildId = $state<string | null>(null);
  let childrenListEl: HTMLDivElement | undefined = $state();

  // Auto-scroll children list to bottom when new children arrive
  $effect(() => {
    if (!expandedId) return;
    const agent = agents.find(a => a.id === expandedId);
    const _childCount = agent?.children?.length ?? 0;
    if (childrenListEl) {
      tick().then(() => {
        if (childrenListEl) childrenListEl.scrollTop = childrenListEl.scrollHeight;
      });
    }
  });

  // Reset expanded child when switching agent cards
  $effect(() => {
    void expandedId;
    expandedChildId = null;
  });

  // Live clock for elapsed timers — ticks every 100ms
  let now = $state(Date.now());
  $effect(() => {
    const interval = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(interval);
  });

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function formatDuration(tc: ToolCall): string {
    // Don't show misleading durations for inferred completions
    if (tc.inferredComplete) return "";
    const end = tc.endTime ?? now;
    const secs = (end - tc.startTime) / 1000;
    if (secs < 60) return `${secs.toFixed(1)}s`;
    return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
  }

  function agentLabel(tc: ToolCall): string {
    const desc = tc.input.description as string | undefined;
    const subtype = tc.input.subagent_type as string | undefined;
    return desc || subtype || "Agent";
  }

  function agentType(tc: ToolCall): string {
    return (tc.input.subagent_type as string) || "general";
  }

  function truncateResult(text: string, lines: number): { text: string; truncated: boolean } {
    const allLines = text.split("\n");
    if (allLines.length <= lines) return { text, truncated: false };
    return { text: allLines.slice(0, lines).join("\n"), truncated: true };
  }

  /** Summarize a child tool call as a short one-liner */
  function childSummary(tc: ToolCall): string {
    const input = tc.input;
    switch (tc.name) {
      case "Thinking": {
        const text = (tc.result || "").replace(/\s+/g, " ").trim();
        return text.length > 50 ? text.slice(0, 50) + "..." : text || "...";
      }
      case "Read": return (input.file_path as string)?.split(/[\\/]/).pop() || "file";
      case "Write": return (input.file_path as string)?.split(/[\\/]/).pop() || "file";
      case "Edit": return (input.file_path as string)?.split(/[\\/]/).pop() || "file";
      case "Bash": {
        const cmd = (input.command as string) || "";
        return cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
      }
      case "Grep": return (input.pattern as string) || "search";
      case "Glob": return (input.pattern as string) || "pattern";
      case "WebFetch": return "fetch";
      case "WebSearch": return (input.query as string) || "search";
      default: return tc.name;
    }
  }

  /** Get the currently active child (last incomplete one) */
  function activeChild(agent: ToolCall): ToolCall | undefined {
    if (!agent.children?.length) return undefined;
    for (let i = agent.children.length - 1; i >= 0; i--) {
      if (!agent.children[i].isComplete) return agent.children[i];
    }
    return undefined;
  }

  /** Full path/command for hover title tooltip */
  function childFullPath(tc: ToolCall): string {
    const i = tc.input;
    if (i.file_path) return String(i.file_path);
    if (i.command) return String(i.command);
    if (i.pattern) return String(i.pattern);
    if (i.query) return String(i.query);
    if (i.url) return String(i.url);
    return tc.name;
  }

  let activeAgents = $derived(agents.filter((a) => !a.isComplete));
  let activeCount = $derived(activeAgents.length);
  let totalCount = $derived(agents.length);
</script>

<!-- Toggle tab — visible when there are agents and panel is closed -->
{#if !open && totalCount > 0}
  <button
    class="panel-tab"
    class:has-active={activeCount > 0}
    class:tab-hidden={hidden}
    onclick={hidden ? undefined : onToggle}
    title="Show agents"
    disabled={hidden}
  >
    <span class="tab-icon">A</span>
    {#if activeCount > 0}
      <span class="tab-badge">{activeCount}</span>
    {:else}
      <span class="tab-badge dim">{totalCount}</span>
    {/if}
  </button>
{/if}

{#if open && totalCount > 0}
  <aside class="agent-panel">
    <div class="panel-header">
      <span class="panel-title">agents</span>
      <span class="panel-count">{totalCount}</span>
      <button class="panel-close" onclick={onToggle} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
          <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>

    <div class="agent-list">
      {#each agents as agent (agent.id)}
        {@const isExpanded = expandedId === agent.id}
        <div
          class="agent-card"
          class:expanded={isExpanded}
          class:done={agent.isComplete}
        >
          <button
            class="agent-header"
            onclick={() => toggleExpand(agent.id)}
          >
            <div class="agent-status">
              {#if !agent.isComplete}
                <span class="pulse-dot"></span>
              {:else}
                <span class="done-dot"></span>
              {/if}
            </div>
            <div class="agent-info">
              <span class="agent-label">{agentLabel(agent)}</span>
              <span class="agent-type">{agentType(agent)}</span>
            </div>
            <div class="agent-meta">
              <span class="agent-dur" class:live={!agent.isComplete}>{formatDuration(agent)}</span>
              <span class="expand-chevron" class:open={isExpanded}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </div>
          </button>

          <!-- Activity bar: live tool when running, "DONE!" when finished (collapsed only) -->
          {#if !isExpanded}
            {#if !agent.isComplete && agent.children?.length}
              {@const current = activeChild(agent)}
              {#if current}
                <div class="agent-activity" class:thinking-activity={current.name === "Thinking"}>
                  <span class="activity-icon">{getToolIcon(current.name)}</span>
                  {#if current.name === "Thinking"}
                    <span class="activity-detail thinking-text">{childSummary(current)}</span>
                  {:else}
                    <span class="activity-tool">{current.name}</span>
                    <span class="activity-detail">{childSummary(current)}</span>
                  {/if}
                </div>
              {/if}
            {:else if agent.isComplete}
              <div class="agent-activity done-activity">
                <span class="activity-done-label">done</span>
              </div>
            {/if}
          {/if}

          {#if isExpanded}
            <div class="agent-body">
              <!-- Children activity feed -->
              {#if agent.children?.length}
                <div class="agent-section">
                  <span class="section-label">activity ({agent.children.filter(c => c.name !== "Thinking").length} tools)</span>
                  <div class="children-list" bind:this={childrenListEl}>
                    {#each agent.children as child (child.id)}
                      <div
                        class="child-row"
                        class:child-done={child.isComplete}
                        class:child-error={child.isError}
                        class:child-thinking={child.name === "Thinking"}
                        class:child-expanded={expandedChildId === child.id}
                        role="button"
                        tabindex="0"
                        onclick={() => expandedChildId = expandedChildId === child.id ? null : child.id}
                        onkeydown={(e) => e.key === "Enter" && (expandedChildId = expandedChildId === child.id ? null : child.id)}
                        title={child.name === "Thinking" ? (child.result?.slice(0, 200) || "") : childFullPath(child)}
                      >
                        <span class="child-status">
                          {#if !child.isComplete}
                            <span class="child-pulse"></span>
                          {:else if child.isError}
                            <span class="child-error-dot"></span>
                          {:else}
                            <span class="child-done-dot"></span>
                          {/if}
                        </span>
                        <span class="child-icon">{getToolIcon(child.name)}</span>
                        {#if child.name === "Thinking"}
                          <span class="child-detail child-thinking-preview">{childSummary(child)}</span>
                        {:else}
                          <span class="child-name">{child.name}</span>
                          <span class="child-detail">{childSummary(child)}</span>
                        {/if}
                        <span class="child-dur">{formatDuration(child)}</span>
                      </div>
                      {#if expandedChildId === child.id}
                        <div class="child-body">
                          {#if child.name !== "Thinking" && Object.keys(child.input).length > 0}
                            <pre class="child-block">{JSON.stringify(child.input, null, 2)}</pre>
                          {/if}
                          {#if child.result}
                            {@const r = truncateResult(child.result, 20)}
                            <pre class="child-block child-result-text" class:child-thinking-text={child.name === "Thinking"}>{r.text}{#if r.truncated}<span class="child-fade-out"></span>{/if}</pre>
                          {:else if child.isComplete && !child.inferredComplete}
                            <span class="child-no-output">no output</span>
                          {/if}
                        </div>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/if}

              {#if agent.input.prompt}
                <div class="agent-section">
                  <span class="section-label">prompt</span>
                  <pre class="section-content">{agent.input.prompt}</pre>
                </div>
              {/if}
              {#if agent.result}
                {@const r = truncateResult(agent.result, 30)}
                <div class="agent-section">
                  <span class="section-label">result</span>
                  <pre class="section-content result">{r.text}{#if r.truncated}<span class="fade-out"></span>{/if}</pre>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </aside>
{/if}

<style>
  /* ── Toggle tab ── */
  .panel-tab {
    position: absolute;
    right: 10px;
    top: 58%;
    transform: translateY(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      background 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .panel-tab.tab-hidden {
    opacity: 0;
    transform: translateY(-50%) translateX(20px) scale(0.8);
    pointer-events: none;
  }

  .panel-tab:hover {
    color: var(--text);
    background: var(--bg-glass-hover);
    border-color: var(--border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    transform: translateY(-50%) scale(1.05);
  }

  .tab-icon {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
  }

  .panel-tab.has-active {
    color: var(--text-secondary);
  }

  .tab-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
    min-width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.25);
    color: var(--text);
    animation: fadeIn 0.3s var(--ease-out-expo);
  }

  .tab-badge.dim {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-tertiary);
  }

  /* ── Floating panel ── */
  .agent-panel {
    position: absolute;
    right: 12px;
    top: 12px;
    bottom: 12px;
    width: 280px;
    background: var(--glass-panel-bg);
    -webkit-backdrop-filter: var(--glass-panel-blur);
    backdrop-filter: var(--glass-panel-blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    z-index: 9;
    animation: panelSlideIn 0.25s var(--ease-out-expo);
    overflow: hidden;
  }

  @keyframes panelSlideIn {
    from { transform: translateX(16px) scale(0.96); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .panel-close {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.2s var(--ease-out-quart);
    opacity: 0.4;
  }
  .panel-close:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
    opacity: 1;
    transform: rotate(90deg);
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .panel-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .panel-empty {
    padding: 24px 16px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  /* ── Agent list ── */
  .agent-list {
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 2px;
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
  }

  .agent-card {
    border-radius: 8px;
    transition: background 0.15s ease;
  }

  .agent-card:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .agent-card.expanded {
    background: rgba(255, 255, 255, 0.03);
  }

  /* ── Agent header ── */
  .agent-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .agent-status {
    flex-shrink: 0;
    width: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    animation: glow 2s ease-in-out infinite;
  }

  @keyframes glow {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .done-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
  }

  .agent-card.done {
    opacity: 0.5;
    filter: saturate(0.15);
  }

  .agent-card.done:hover {
    opacity: 0.7;
    filter: saturate(0.3);
  }

  .agent-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .agent-label {
    font-family: var(--font-sans);
    font-size: 11.5px;
    font-weight: 450;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  .agent-type {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.7;
  }

  .agent-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .agent-dur {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .agent-dur.live {
    color: var(--text-secondary);
    opacity: 0.8;
  }

  .expand-chevron {
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity 0.15s ease, transform 0.2s var(--ease-out-expo);
    display: flex;
    align-items: center;
  }

  .agent-card:hover .expand-chevron {
    opacity: 0.4;
  }

  .expand-chevron.open {
    transform: rotate(180deg);
    opacity: 0.5;
  }

  /* ── Expanded body ── */
  .agent-body {
    padding: 0 10px 10px 26px;
    animation: bodyIn 0.2s var(--ease-out-expo);
  }

  @keyframes bodyIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .agent-section {
    margin-top: 6px;
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    color: var(--text-tertiary);
    opacity: 0.6;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    display: block;
    margin-bottom: 4px;
  }

  .section-content {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
  }

  .section-content.result {
    color: var(--text-tertiary);
    font-size: 10px;
    position: relative;
  }

  .fade-out {
    display: block;
    height: 20px;
    background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.2));
    margin: 0 -8px -6px;
    pointer-events: none;
  }

  /* ── Live activity bar (collapsed) ── */
  .agent-activity {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 6px 28px;
    animation: fadeIn 0.2s ease;
    overflow: hidden;
  }

  .activity-icon {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-tertiary);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .activity-tool {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .activity-detail {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.45;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .done-activity {
    opacity: 0.6;
  }

  .activity-done-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    color: var(--text-tertiary);
    letter-spacing: 0.5px;
  }

  /* ── Children list (expanded) ── */
  .children-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    padding: 4px 0;
    max-height: 200px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
  }

  .child-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    transition: opacity 0.15s ease, background 0.15s ease;
    cursor: pointer;
    border-radius: 4px;
  }

  .child-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .child-row.child-expanded {
    background: rgba(255, 255, 255, 0.05);
  }

  .child-row.child-done {
    opacity: 0.5;
  }

  .child-row.child-error {
    opacity: 0.8;
  }

  .child-status {
    flex-shrink: 0;
    width: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .child-pulse {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
    animation: glow 1.5s ease-in-out infinite;
  }

  .child-done-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
  }

  .child-error-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-error);
  }

  .child-icon {
    font-family: var(--font-mono);
    font-size: 8px;
    color: var(--text-tertiary);
    opacity: 0.4;
    flex-shrink: 0;
    width: 8px;
    text-align: center;
  }

  .child-name {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.8;
    flex-shrink: 0;
  }

  .child-detail {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  .child-dur {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-tertiary);
    opacity: 0.35;
    flex-shrink: 0;
  }

  /* ── Child expanded body ── */
  .child-body {
    padding: 4px 8px 6px 20px;
    animation: bodyIn 0.2s var(--ease-out-expo);
  }

  .child-block {
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 0;
    padding: 5px 7px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 5px;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
    position: relative;
  }

  .child-block + .child-block {
    margin-top: 3px;
  }

  .child-result-text {
    color: var(--text-tertiary);
    font-size: 9.5px;
  }

  .child-fade-out {
    display: block;
    height: 16px;
    background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.25));
    margin: 0 -7px -5px;
    pointer-events: none;
  }

  .child-no-output {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.4;
    font-style: italic;
    padding: 2px 0;
  }

  /* ── Thinking children ── */
  .child-row.child-thinking {
    opacity: 0.45;
  }

  .child-row.child-thinking:hover {
    opacity: 0.7;
  }

  .child-row.child-thinking.child-expanded {
    opacity: 0.7;
  }

  .child-row.child-thinking:not(.child-done) {
    opacity: 0.6;
  }

  .child-thinking-preview {
    font-style: italic;
    opacity: 0.5;
  }

  .child-thinking-text {
    font-style: italic;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .thinking-activity {
    opacity: 0.5;
  }

  .thinking-text {
    font-style: italic;
    opacity: 0.6;
  }

  :global([data-theme="light"]) .children-list {
    background: rgba(0, 0, 0, 0.04);
  }

  :global([data-theme="light"]) .child-block {
    background: rgba(0, 0, 0, 0.04);
  }

  :global([data-theme="light"]) .child-row:hover {
    background: rgba(0, 0, 0, 0.03);
  }
</style>
