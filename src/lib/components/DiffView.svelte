<script lang="ts">
  /**
   * DiffView — renders a unified diff between old and new text.
   * Used by ToolCallCard for Edit and Write tool calls.
   */

  type DiffLine = {
    type: "add" | "remove" | "context";
    text: string;
    oldNum?: number;
    newNum?: number;
  };

  let {
    oldText = "",
    newText = "",
    filePath = "",
  }: {
    oldText?: string;
    newText?: string;
    filePath?: string;
  } = $props();

  const diffLines = $derived.by(() => computeDiff(oldText, newText));

  /**
   * Simple line-level diff using longest common subsequence.
   * Produces a minimal unified diff without pulling in a library.
   */
  function computeDiff(oldStr: string, newStr: string): DiffLine[] {
    const oldLines = oldStr ? oldStr.split("\n") : [];
    const newLines = newStr ? newStr.split("\n") : [];

    // If no old text, everything is added (Write tool)
    if (oldLines.length === 0 || (oldLines.length === 1 && oldLines[0] === "")) {
      return newLines.map((text, i) => ({
        type: "add" as const,
        text,
        newNum: i + 1,
      }));
    }

    // LCS-based diff
    const m = oldLines.length;
    const n = newLines.length;

    // Build LCS table
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      new Array(n + 1).fill(0),
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to produce diff
    const result: DiffLine[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.push({
          type: "context",
          text: oldLines[i - 1],
          oldNum: i,
          newNum: j,
        });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.push({ type: "add", text: newLines[j - 1], newNum: j });
        j--;
      } else {
        result.push({ type: "remove", text: oldLines[i - 1], oldNum: i });
        i--;
      }
    }

    result.reverse();

    // Collapse long unchanged sections — keep 2 context lines around changes
    return collapseContext(result, 2);
  }

  function collapseContext(lines: DiffLine[], keep: number): DiffLine[] {
    // Find indices of changed lines
    const changed = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "context") changed.add(i);
    }

    // Mark which context lines to keep (within `keep` of a change)
    const visible = new Set<number>();
    for (const idx of changed) {
      visible.add(idx);
      for (let d = 1; d <= keep; d++) {
        if (idx - d >= 0) visible.add(idx - d);
        if (idx + d < lines.length) visible.add(idx + d);
      }
    }

    // If everything is visible or no changes, return as-is
    if (visible.size >= lines.length || changed.size === 0) return lines;

    const collapsed: DiffLine[] = [];
    let skipping = false;
    for (let i = 0; i < lines.length; i++) {
      if (visible.has(i)) {
        skipping = false;
        collapsed.push(lines[i]);
      } else if (!skipping) {
        skipping = true;
        // Separator line
        collapsed.push({ type: "context", text: "\u22ee" });
      }
    }
    return collapsed;
  }
</script>

{#if filePath}
  <div class="file-header">{filePath}</div>
{/if}
<div class="diff">
  {#each diffLines as line}
    <div class="line {line.type}">
      <span class="gutter old-gutter">{line.type === "add" ? "" : line.oldNum ?? ""}</span>
      <span class="gutter new-gutter">{line.type === "remove" ? "" : line.newNum ?? ""}</span>
      <span class="marker">{line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}</span>
      <span class="text">{line.text}</span>
    </div>
  {/each}
</div>

<style>
  .file-header {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-secondary);
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 6px 6px 0 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global([data-theme="light"]) .file-header {
    background: rgba(0, 0, 0, 0.03);
    border-bottom-color: rgba(0, 0, 0, 0.06);
  }

  .diff {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 0 0 6px 6px;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  /* When no file-header, give top corners */
  .diff:first-child {
    border-radius: 6px;
  }

  .line {
    display: flex;
    min-height: 20px;
    padding: 0 8px 0 0;
  }

  .line.add {
    background: var(--color-add-bg);
  }

  .line.remove {
    background: var(--color-remove-bg);
  }

  .gutter {
    width: 32px;
    min-width: 32px;
    text-align: right;
    padding-right: 6px;
    color: var(--text-tertiary);
    font-size: 10px;
    user-select: none;
    opacity: 0.6;
  }

  .marker {
    width: 14px;
    min-width: 14px;
    text-align: center;
    user-select: none;
    font-weight: 600;
  }

  .line.add .marker {
    color: var(--color-add);
  }

  .line.remove .marker {
    color: var(--color-remove);
  }

  .line.context .marker {
    color: transparent;
  }

  .text {
    flex: 1;
    white-space: pre;
    color: var(--text-secondary);
  }

  .line.add .text {
    color: var(--color-add);
  }

  .line.remove .text {
    color: var(--color-remove);
    text-decoration: line-through;
    /* Fix: --color-remove-bg is rgba(255,100,100,0.06) — invisible as strikethrough color */
    text-decoration-color: currentColor;
  }
</style>
