<script lang="ts">
  import type { FileChange, FileStats } from "../types";
  import DiffView from "./DiffView.svelte";

  let {
    changes,
    fileStats,
    open,
    hidden = false,
    onToggle,
    onOpenEditor,
  }: {
    changes: FileChange[];
    fileStats: Map<string, FileStats>;
    open: boolean;
    hidden?: boolean;
    onToggle: () => void;
    onOpenEditor: (filePath: string) => void;
  } = $props();

  let expandedFiles = $state<Set<string>>(new Set());
  let expandedChanges = $state<Set<number>>(new Set());

  /** Group changes by file path */
  const groupedChanges = $derived.by(() => {
    const groups = new Map<string, { changes: FileChange[]; stats?: FileStats }>();
    for (const change of changes) {
      const key = change.filePath;
      if (!groups.has(key)) {
        groups.set(key, { changes: [], stats: fileStats.get(key) });
      }
      groups.get(key)!.changes.push(change);
    }
    return groups;
  });

  /** Total count of changed files (with actual edits/writes, not reads) */
  const changedFileCount = $derived(groupedChanges.size);

  function toggleFile(path: string) {
    const next = new Set(expandedFiles);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedFiles = next;
  }

  function toggleChange(idx: number) {
    const next = new Set(expandedChanges);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    expandedChanges = next;
  }

  function shortPath(path: string): string {
    return path.replace(/\\/g, "/").split("/").slice(-2).join("/");
  }

  function fileName(path: string): string {
    return path.replace(/\\/g, "/").split("/").pop() || path;
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function countLines(text: unknown): number {
    if (typeof text !== "string" || !text) return 0;
    return text.split("\n").length;
  }

  /** Global change index for expand tracking */
  let changeCounter = 0;
  function getChangeIdx(fileIdx: number, changeIdx: number): number {
    return fileIdx * 1000 + changeIdx;
  }
</script>

<!-- Tab handle when closed -->
{#if !open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tracker-tab" class:tab-hidden={hidden} onclick={hidden ? undefined : onToggle}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
    {#if changedFileCount > 0}
      <span class="badge">{changedFileCount}</span>
    {/if}
  </div>
{/if}

{#if open}
  <div class="tracker-panel">
    <div class="panel-header">
      <span class="panel-title">changes</span>
      <div class="panel-header-right">
        <span class="file-count">{changedFileCount} file{changedFileCount !== 1 ? "s" : ""}</span>
        <button class="icon-btn" onclick={onToggle} title="Close change tracker">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>
    </div>

    <div class="tracker-scroll">
      {#if changedFileCount === 0}
        <div class="empty-msg">no code changes yet</div>
      {:else}
        {#each [...groupedChanges.entries()] as [filePath, group], fileIdx}
          {@const isExpanded = expandedFiles.has(filePath)}
          {@const stats = group.stats}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="file-group">
            <div class="file-header" onclick={() => toggleFile(filePath)}>
              <svg class="chevron" class:open={isExpanded} width="10" height="10" viewBox="0 0 10 10">
                <polyline points="3,2 7,5 3,8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg class="icon-file" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span class="file-name" title={filePath}>{fileName(filePath)}</span>
              <span class="change-count">{group.changes.length}x</span>
              {#if stats && (stats.added > 0 || stats.removed > 0)}
                <span class="diff-stats">
                  {#if stats.added > 0}<span class="diff-add">+{stats.added}</span>{/if}
                  {#if stats.removed > 0}<span class="diff-rm">-{stats.removed}</span>{/if}
                </span>
              {/if}
            </div>

            {#if isExpanded}
              <div class="file-path-row">
                <span class="file-path-text" title={filePath}>{shortPath(filePath)}</span>
                <button class="open-btn" onclick={() => onOpenEditor(filePath)} title="Open in editor">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
              <div class="changes-list">
                {#each group.changes as change, changeIdx}
                  {@const cIdx = getChangeIdx(fileIdx, changeIdx)}
                  {@const isChangeExpanded = expandedChanges.has(cIdx)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="change-item" class:error={change.isError}>
                    <div class="change-header" onclick={() => toggleChange(cIdx)}>
                      <span class="change-tool" class:write={change.tool === "Write"}>{change.tool}</span>
                      <span class="change-time">{formatTime(change.timestamp)}</span>
                      {#if change.tool === "Edit"}
                        {@const oldL = countLines(change.oldString)}
                        {@const newL = countLines(change.newString)}
                        <span class="change-summary">{oldL} → {newL} lines</span>
                      {:else}
                        <span class="change-summary">{countLines(change.content)} lines</span>
                      {/if}
                      {#if change.isError}
                        <span class="error-badge">err</span>
                      {/if}
                      <svg class="chevron-sm" class:open={isChangeExpanded} width="8" height="8" viewBox="0 0 10 10">
                        <polyline points="3,2 7,5 3,8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </div>
                    {#if isChangeExpanded}
                      <div class="change-diff">
                        {#if change.tool === "Edit"}
                          <DiffView oldText={change.oldString || ""} newText={change.newString || ""} />
                        {:else}
                          <DiffView oldText="" newText={change.content || ""} />
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .tracker-tab {
    position: absolute;
    right: 10px;
    top: 36%;
    transform: translateY(-50%);
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
    color: var(--text-tertiary);
    cursor: pointer;
    transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
      background 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .tracker-tab.tab-hidden {
    opacity: 0;
    transform: translateY(-50%) translateX(20px) scale(0.8);
    pointer-events: none;
  }

  .tracker-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-glass-hover);
    border-color: var(--border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    transform: translateY(-50%) scale(1.05);
  }

  .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    background: var(--accent-purple);
    color: var(--bg-base);
    padding: 1px 4px;
    border-radius: 6px;
    min-width: 14px;
    text-align: center;
    line-height: 1.3;
  }

  .tracker-panel {
    position: absolute;
    right: 12px;
    top: 12px;
    bottom: 12px;
    width: 320px;
    background: var(--glass-panel-bg);
    -webkit-backdrop-filter: var(--glass-panel-blur);
    backdrop-filter: var(--glass-panel-blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    z-index: 9;
    animation: slideInRight 0.25s var(--ease-out-expo);
    overflow: hidden;
  }

  @keyframes slideInRight {
    from { transform: translateX(16px) scale(0.96); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .panel-header-right {
    display: flex;
    align-items: center;
    gap: 6px;
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

  .file-count {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s var(--ease-out-quart);
    opacity: 0.4;
  }
  .icon-btn:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
    opacity: 1;
  }

  .tracker-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 0;
  }

  .empty-msg {
    padding: 24px 16px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0.5;
    text-align: center;
  }

  .file-group {
    border-bottom: 1px solid var(--border-subtle);
  }

  .file-group:last-child {
    border-bottom: none;
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 10px 7px 10px;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .file-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.15s ease;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .icon-file {
    flex-shrink: 0;
    color: var(--accent-purple);
    opacity: 0.8;
  }

  .file-name {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent-purple);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .change-count {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .diff-stats {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .diff-add { color: var(--color-add); }
  .diff-rm { color: var(--color-remove); }

  .file-path-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px 4px 30px;
  }

  .file-path-text {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .open-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.3;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .open-btn:hover {
    opacity: 1;
    color: var(--accent-purple);
    background: var(--accent-purple-soft);
  }

  .changes-list {
    padding: 0 6px 6px 6px;
  }

  .change-item {
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 3px;
    background: rgba(0, 0, 0, 0.1);
  }

  .change-item.error {
    border-left: 2px solid var(--color-error);
  }

  .change-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .change-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .change-tool {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-modify);
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--color-modify-bg);
    flex-shrink: 0;
  }

  .change-tool.write {
    color: var(--accent-blue);
    background: var(--accent-blue-soft);
  }

  .change-time {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.4;
    flex-shrink: 0;
  }

  .change-summary {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.5;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-badge {
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-error);
    background: var(--color-error-soft);
    padding: 1px 3px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .chevron-sm {
    flex-shrink: 0;
    transition: transform 0.15s ease;
    color: var(--text-tertiary);
    opacity: 0.4;
    margin-left: auto;
  }

  .chevron-sm.open {
    transform: rotate(90deg);
  }

  .change-diff {
    padding: 0 4px 6px 4px;
    max-height: 300px;
    overflow-y: auto;
  }

  /* Light theme */
  :global([data-theme="light"]) .tracker-panel {
    background: var(--glass-panel-bg);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  :global([data-theme="light"]) .tracker-tab {
    background: rgba(255, 255, 255, 0.7);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  :global([data-theme="light"]) .file-header:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  :global([data-theme="light"]) .change-header:hover {
    background: rgba(0, 0, 0, 0.03);
  }

  :global([data-theme="light"]) .icon-btn:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  :global([data-theme="light"]) .change-item {
    background: rgba(0, 0, 0, 0.03);
  }
</style>
