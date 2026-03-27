<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type { FileStats } from "../types";

  let {
    cwd,
    open,
    onToggle,
    fileStats,
    onOpenInEditor,
  }: {
    cwd: string;
    open: boolean;
    onToggle: () => void;
    fileStats?: Map<string, FileStats>;
    onOpenInEditor?: (path: string) => void;
  } = $props();

  interface FsEntry {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    extension: string | null;
  }

  let rootEntries = $state<FsEntry[]>([]);
  let childrenCache = $state<Map<string, FsEntry[]>>(new Map());
  let expanded = $state<Set<string>>(new Set());
  let loadedDirs = $state<Set<string>>(new Set());
  let loading = $state<Set<string>>(new Set());

  let projectName = $derived(
    cwd ? cwd.replace(/\\/g, "/").split("/").pop() || "" : "",
  );

  // Reload root when cwd changes
  let prevCwd = "";
  $effect(() => {
    if (cwd && cwd !== prevCwd) {
      prevCwd = cwd;
      expanded = new Set();
      childrenCache = new Map();
      loadedDirs = new Set();
      loadDir(cwd, true);
    } else if (!cwd) {
      rootEntries = [];
    }
  });

  async function loadDir(path: string, isRoot = false) {
    loading = new Set(loading).add(path);
    try {
      const entries: FsEntry[] = await invoke("list_directory", { path });
      if (isRoot) {
        rootEntries = entries;
      } else {
        childrenCache = new Map(childrenCache).set(path, entries);
      }
      loadedDirs = new Set(loadedDirs).add(path);
    } catch {
      if (isRoot) rootEntries = [];
    }
    const next = new Set(loading);
    next.delete(path);
    loading = next;
  }

  async function toggleDir(entry: FsEntry) {
    const key = entry.path;
    const next = new Set(expanded);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!loadedDirs.has(key)) {
        await loadDir(key);
      }
    }
    expanded = next;
  }

  async function openFile(entry: FsEntry) {
    // If built-in editor callback is available, use it
    if (onOpenInEditor) {
      onOpenInEditor(entry.path);
      return;
    }
    const editor = localStorage.getItem("clauke:editor") || "vscode";
    try {
      await invoke("open_in_editor", { editor, file: entry.path, cwd });
    } catch { /* silently fail */ }
  }

  async function openExternal(entry: FsEntry) {
    const editor = localStorage.getItem("clauke:editor") || "vscode";
    try {
      await invoke("open_in_editor", { editor, file: entry.path, cwd });
    } catch { /* silently fail */ }
  }

  function refresh() {
    childrenCache = new Map();
    loadedDirs = new Set();
    const wasExpanded = new Set(expanded);
    expanded = new Set();
    loadDir(cwd, true).then(() => {
      // Re-expand previously expanded dirs
      expanded = wasExpanded;
      for (const dir of wasExpanded) {
        loadDir(dir);
      }
    });
  }

  function getStats(path: string): FileStats | undefined {
    if (!fileStats) return undefined;
    // Try exact match, then try with normalized separators
    return fileStats.get(path) || fileStats.get(path.replace(/\//g, "\\"));
  }

  function getChildren(path: string): FsEntry[] {
    return childrenCache.get(path) || [];
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }
</script>

{#snippet treeNodes(entries: FsEntry[], depth: number)}
  {#each entries as entry}
    {@const isExpanded = expanded.has(entry.path)}
    {@const isLoading = loading.has(entry.path)}
    {@const stats = getStats(entry.path)}
    {@const hasChanges = stats && (stats.added > 0 || stats.removed > 0)}
    {#if entry.is_dir}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tree-item dir"
        style:padding-left="{12 + depth * 14}px"
        onclick={() => toggleDir(entry)}
        onselectstart={(e: Event) => e.preventDefault()}
      >
        <svg class="chevron" class:open={isExpanded} width="10" height="10" viewBox="0 0 10 10">
          <polyline points="3,2 7,5 3,8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg class="icon-dir" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span class="name">{entry.name}</span>
        {#if isLoading}
          <span class="loading-dot"></span>
        {/if}
      </div>
      {#if isExpanded}
        {@render treeNodes(getChildren(entry.path), depth + 1)}
      {/if}
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tree-item file"
        class:modified={hasChanges}
        style:padding-left="{12 + depth * 14 + 14}px"
        title="{entry.path}{stats ? ` (${stats.reads}R ${stats.writes}W)` : ''}\nclick: built-in editor | middle-click: external editor"
        onclick={() => openFile(entry)}
        onauxclick={(e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); openExternal(entry); } }}
        onselectstart={(e: Event) => e.preventDefault()}
      >
        <svg class="icon-file" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="name">{entry.name}</span>
        {#if hasChanges}
          <span class="diff-stats">
            {#if stats && stats.added > 0}<span class="diff-add">+{stats.added}</span>{/if}
            {#if stats && stats.removed > 0}<span class="diff-rm">-{stats.removed}</span>{/if}
          </span>
        {:else}
          <span class="file-size">{formatSize(entry.size)}</span>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

<!-- Tab handle — only visible when panel is closed -->
{#if !open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="filetree-tab" onclick={onToggle}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  </div>
{/if}

{#if open}
  <div class="filetree-panel">
    <div class="panel-header">
      <span class="panel-title">{projectName || "files"}</span>
      <div class="panel-header-right">
        <button class="icon-btn" onclick={refresh} title="Refresh">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        <button class="icon-btn" onclick={onToggle} title="Close file tree">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tree-scroll" onmousedown={(e: MouseEvent) => { if (e.button === 1) e.preventDefault(); }}>
      {#if !cwd}
        <div class="empty-msg">no working directory set</div>
      {:else if rootEntries.length === 0 && loading.size > 0}
        <div class="empty-msg">loading...</div>
      {:else if rootEntries.length === 0}
        <div class="empty-msg">empty directory</div>
      {:else}
        {@render treeNodes(rootEntries, 0)}
      {/if}
    </div>
    {#if !onOpenInEditor && !localStorage.getItem("clauke:editor")}
      <div class="no-editor-hint">set preferred editor in settings to open files</div>
    {/if}
  </div>
{/if}

<style>
  .filetree-tab {
    position: absolute;
    left: 10px;
    top: 50%;
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
    transition: all 0.2s ease;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .filetree-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-glass-hover);
    border-color: var(--border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    transform: translateY(-50%) scale(1.05);
  }

  .filetree-panel {
    position: absolute;
    left: 12px;
    top: 12px;
    bottom: 12px;
    width: 260px;
    background: var(--glass-panel-bg);
    -webkit-backdrop-filter: var(--glass-panel-blur);
    backdrop-filter: var(--glass-panel-blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    z-index: 9;
    animation: slideIn 0.25s var(--ease-out-expo);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }

  @keyframes slideIn {
    from { transform: translateX(-16px) scale(0.96); opacity: 0; }
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
    gap: 4px;
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .tree-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 0;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px 3px 8px;
    cursor: default;
    transition: background 0.1s ease;
    min-height: 24px;
  }

  .tree-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .tree-item.dir {
    cursor: pointer;
  }

  .tree-item.file {
    cursor: pointer;
  }

  .tree-item.file:hover {
    background: rgba(255, 255, 255, 0.06);
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

  .icon-dir {
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  .icon-file {
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0.4;
  }

  .tree-item.modified .icon-file {
    color: var(--color-modify);
    opacity: 0.8;
  }

  .name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .tree-item.dir .name {
    font-weight: 450;
  }

  .tree-item.modified .name {
    color: var(--color-modify);
  }

  .file-size {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-tertiary);
    opacity: 0.35;
    flex-shrink: 0;
    margin-left: auto;
  }

  .diff-stats {
    display: flex;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .diff-add {
    color: var(--color-add);
  }

  .diff-rm {
    color: var(--color-remove);
  }

  .loading-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-tertiary);
    opacity: 0.4;
    animation: pulse 1s ease-in-out infinite;
    flex-shrink: 0;
    margin-left: auto;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.2; }
    50% { opacity: 0.6; }
  }

  .empty-msg {
    padding: 16px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0.5;
    text-align: center;
  }

  .no-editor-hint {
    padding: 6px 14px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.4;
    border-top: 1px solid var(--border-subtle);
    text-align: center;
  }

  :global([data-theme="light"]) .filetree-panel {
    background: var(--glass-panel-bg);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  :global([data-theme="light"]) .filetree-tab {
    background: rgba(255, 255, 255, 0.7);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  :global([data-theme="light"]) .tree-item:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  :global([data-theme="light"]) .tree-item.file:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  :global([data-theme="light"]) .diff-add {
    color: rgba(30, 160, 70, 0.9);
  }

  :global([data-theme="light"]) .diff-rm {
    color: rgba(210, 50, 50, 0.85);
  }

  :global([data-theme="light"]) .icon-btn:hover {
    background: rgba(0, 0, 0, 0.06);
  }
</style>
