<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, indentWithTab } from "@codemirror/commands";
  import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from "@codemirror/language";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { javascript } from "@codemirror/lang-javascript";
  import { rust } from "@codemirror/lang-rust";
  import { python } from "@codemirror/lang-python";
  import { html } from "@codemirror/lang-html";
  import { css } from "@codemirror/lang-css";
  import { json } from "@codemirror/lang-json";
  import { markdown } from "@codemirror/lang-markdown";
  import { cpp } from "@codemirror/lang-cpp";
  import { java } from "@codemirror/lang-java";
  import { sql } from "@codemirror/lang-sql";
  import { xml } from "@codemirror/lang-xml";
  import { yaml } from "@codemirror/lang-yaml";
  import { go } from "@codemirror/lang-go";
  import { php } from "@codemirror/lang-php";
  import { sass } from "@codemirror/lang-sass";

  let {
    filePath = "",
    open,
    onClose,
  }: {
    filePath: string;
    open: boolean;
    onClose: () => void;
  } = $props();

  let loading = $state(false);
  let saving = $state(false);
  let error = $state("");
  let saveMsg = $state("");
  let modified = $state(false);
  let lineCount = $state(0);

  let visible = $state(false);
  let closing = $state(false);

  let loadedPath = "";
  let originalContent = "";
  let editorContainer: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;

  $effect(() => {
    if (open && filePath && filePath !== loadedPath) {
      loadFile(filePath);
    }
    if (open && !visible) {
      closing = false;
      visible = true;
    } else if (!open && visible && !closing) {
      closing = true;
      setTimeout(() => {
        visible = false;
        closing = false;
      }, 200);
    }
  });

  function getLanguageExtension(ext: string) {
    switch (ext) {
      case "ts": case "tsx": return javascript({ typescript: true, jsx: ext.endsWith("x") });
      case "js": case "jsx": case "mjs": case "cjs": return javascript({ jsx: ext.endsWith("x") });
      case "svelte": case "vue": return html();
      case "rs": return rust();
      case "py": case "pyw": case "pyi": return python();
      case "html": case "htm": return html();
      case "xml": case "svg": case "xaml": return xml();
      case "css": return css();
      case "scss": case "sass": return sass();
      case "json": case "jsonc": case "json5": return json();
      case "md": case "mdx": return markdown();
      case "c": case "cpp": case "cc": case "cxx": case "h": case "hpp": case "hxx": return cpp();
      case "java": case "kt": case "kts": return java();
      case "go": return go();
      case "sql": return sql();
      case "yaml": case "yml": return yaml();
      case "toml": case "ini": case "conf": case "cfg": return yaml(); // closest match
      case "php": return php();
      case "sh": case "bash": case "zsh": case "fish": case "bat": case "cmd": case "ps1": return yaml(); // basic highlighting
      default: return [];
    }
  }

  function getExtension(path: string): string {
    const name = path.replace(/\\/g, "/").split("/").pop() || "";
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.substring(dot + 1).toLowerCase() : "";
  }

  function fileName(path: string): string {
    return path.replace(/\\/g, "/").split("/").pop() || path;
  }

  const langLabel = $derived.by(() => {
    const ext = getExtension(filePath);
    const map: Record<string, string> = {
      ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
      rs: "Rust", py: "Python", go: "Go", rb: "Ruby", java: "Java",
      svelte: "Svelte", vue: "Vue", html: "HTML", css: "CSS", scss: "SCSS",
      json: "JSON", toml: "TOML", yaml: "YAML", yml: "YAML", xml: "XML",
      md: "Markdown", sh: "Shell", bash: "Shell", zsh: "Shell",
      sql: "SQL", c: "C", cpp: "C++", h: "C/C++", cs: "C#",
    };
    return map[ext] || ext || "plain text";
  });

  /** Custom dark theme that matches clauke's midnight aesthetic */
  const claukeTheme = EditorView.theme({
    "&": {
      fontSize: "12px",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      caretColor: "rgba(200, 180, 255, 0.9)",
    },
    ".cm-gutters": {
      background: "rgba(0, 0, 0, 0.1)",
      borderRight: "1px solid var(--border-subtle)",
      color: "var(--text-tertiary)",
      opacity: "0.4",
    },
    ".cm-activeLineGutter": {
      background: "rgba(180, 160, 255, 0.06)",
      opacity: "1",
    },
    ".cm-activeLine": {
      background: "rgba(180, 160, 255, 0.04)",
    },
    ".cm-cursor": {
      borderLeftColor: "rgba(200, 180, 255, 0.9)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      background: "rgba(180, 160, 255, 0.2) !important",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.55",
      overflow: "auto",
    },
  }, { dark: true });

  function createEditor(container: HTMLElement, content: string) {
    if (editorView) {
      editorView.destroy();
    }

    const ext = getExtension(filePath);
    const lang = getLanguageExtension(ext);
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        indentOnInput(),
        bracketMatching(),
        keymap.of([...defaultKeymap, indentWithTab]),
        syntaxHighlighting(defaultHighlightStyle),
        isDark ? oneDark : [],
        isDark ? claukeTheme : [],
        ...(Array.isArray(lang) ? lang : [lang]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const doc = update.state.doc.toString();
            modified = doc !== originalContent;
            lineCount = update.state.doc.lines;
          }
        }),
        // Ctrl+S to save
        keymap.of([{
          key: "Mod-s",
          run: () => { saveFile(); return true; },
        }]),
      ],
    });

    editorView = new EditorView({ state, parent: container });
    lineCount = state.doc.lines;
  }

  async function loadFile(path: string) {
    loading = true;
    error = "";
    modified = false;
    try {
      const text = await invoke<string>("read_file_contents", { path });
      originalContent = text;
      loadedPath = path;
      // Wait for DOM to be ready, then create editor
      requestAnimationFrame(() => {
        if (editorContainer) {
          createEditor(editorContainer, text);
        }
      });
    } catch (e) {
      error = String(e);
      originalContent = "";
    }
    loading = false;
  }

  async function saveFile() {
    if (!filePath || !modified || !editorView) return;
    saving = true;
    try {
      const content = editorView.state.doc.toString();
      await invoke("write_file_contents", { path: filePath, content });
      originalContent = content;
      modified = false;
      saveMsg = "saved";
      setTimeout(() => (saveMsg = ""), 2000);
    } catch (e) {
      saveMsg = "save failed";
      setTimeout(() => (saveMsg = ""), 3000);
    }
    saving = false;
  }

  function handleClose() {
    closing = true;
    loadedPath = "";
    if (editorView) {
      editorView.destroy();
      editorView = undefined;
    }
    setTimeout(() => {
      visible = false;
      closing = false;
      onClose();
    }, 200);
  }

  function handleOverlayKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") handleClose();
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="editor-overlay" class:closing onkeydown={handleOverlayKeydown}>
    <div class="editor-container" class:closing onclick={(e) => e.stopPropagation()}>
      <div class="editor-header">
        <div class="editor-title-group">
          <svg class="icon-file" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span class="editor-filename" title={filePath}>
            {fileName(filePath)}
            {#if modified}<span class="mod-dot"></span>{/if}
          </span>
        </div>
        <div class="editor-actions">
          {#if saveMsg}
            <span class="save-msg" class:error={saveMsg.includes("failed")}>{saveMsg}</span>
          {/if}
          <button class="action-btn" class:active={modified} onclick={saveFile} disabled={!modified || saving} title="Save (Ctrl+S)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </button>
          <button class="action-btn" onclick={handleClose} title="Close (Esc)">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
              <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
            </svg>
          </button>
        </div>
      </div>

      <div class="editor-body">
        {#if loading}
          <div class="editor-loading">loading...</div>
        {:else if error}
          <div class="editor-error">{error}</div>
        {:else}
          <div class="cm-wrapper" bind:this={editorContainer}></div>
        {/if}
      </div>

      <div class="editor-status">
        <span class="status-lang">{langLabel}</span>
        <span class="status-info">{lineCount} lines</span>
        {#if modified}
          <span class="status-modified">modified</span>
        {/if}
        <span class="status-path" title={filePath}>{filePath}</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .editor-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease;
  }

  .editor-overlay.closing {
    animation: fadeOut 0.2s ease forwards;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }

  .editor-container {
    width: 80vw;
    max-width: 900px;
    height: 75vh;
    max-height: 700px;
    display: flex;
    flex-direction: column;
    background: var(--glass-panel-bg);
    -webkit-backdrop-filter: var(--glass-panel-blur);
    backdrop-filter: var(--glass-panel-blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    overflow: hidden;
    animation: scaleIn 0.2s var(--ease-out-expo);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  .editor-container.closing {
    animation: scaleOut 0.2s ease forwards;
  }

  @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @keyframes scaleOut { from { transform: scale(1); opacity: 1; } to { transform: scale(0.95); opacity: 0; } }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    background: rgba(0, 0, 0, 0.15);
  }

  .editor-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .icon-file {
    flex-shrink: 0;
    color: rgba(180, 160, 255, 0.7);
  }

  .editor-filename {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mod-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 180, 60, 0.8);
    flex-shrink: 0;
  }

  .editor-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .save-msg {
    font-family: var(--font-mono);
    font-size: 10px;
    color: rgba(100, 220, 140, 0.8);
    animation: fadeIn 0.15s ease;
  }
  .save-msg.error {
    color: rgba(255, 100, 100, 0.8);
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
    border-radius: 5px;
    transition: all 0.15s ease;
    opacity: 0.4;
  }
  .action-btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); }
  .action-btn.active { opacity: 0.8; color: rgba(180, 160, 255, 0.9); }
  .action-btn:disabled { opacity: 0.2; cursor: default; }

  .editor-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .editor-loading, .editor-error {
    padding: 24px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
  }
  .editor-error { color: rgba(255, 100, 100, 0.8); }

  /* CodeMirror container — fills editor body */
  .cm-wrapper {
    height: 100%;
    overflow: hidden;
  }

  /* CodeMirror overrides to blend with clauke theme */
  .cm-wrapper :global(.cm-editor) {
    height: 100%;
    background: transparent;
  }

  .cm-wrapper :global(.cm-scroller) {
    overflow: auto;
  }

  .cm-wrapper :global(.cm-focused) {
    outline: none;
  }

  .editor-status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 12px;
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
    background: rgba(0, 0, 0, 0.15);
  }

  .status-lang {
    font-family: var(--font-mono);
    font-size: 10px;
    color: rgba(180, 160, 255, 0.6);
    text-transform: lowercase;
  }

  .status-info {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.4;
  }

  .status-modified {
    font-family: var(--font-mono);
    font-size: 10px;
    color: rgba(255, 180, 60, 0.7);
  }

  .status-path {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.3;
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Light theme overrides */
  :global([data-theme="light"]) .editor-container {
    background: var(--glass-panel-bg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
  }

  :global([data-theme="light"]) .editor-header,
  :global([data-theme="light"]) .editor-status {
    background: rgba(0, 0, 0, 0.03);
  }
</style>
