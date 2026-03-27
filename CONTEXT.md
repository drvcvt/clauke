# clauke — Project Context

## Overview

**clauke** (Claude + Cloak) is a lightweight desktop GUI wrapper around the `claude` CLI tool.
It provides a polished chat interface for Claude Code without reimplementing any AI logic —
instead it spawns the official CLI in `stream-json` mode and renders the output as a rich UI.

**Status:** v0.1.0 — functional prototype, actively developed.

## Motivation

The official Claude Code CLI is powerful but terminal-only. clauke adds:
- A proper desktop window with a dark "midnight cloak" theme (deep purples/violets)
- Multi-tab sessions — run parallel conversations in separate tabs
- Visual tool call cards — see what Claude is doing (file reads, edits, bash commands) as collapsible, color-coded cards
- Session persistence and history — tabs survive restarts, closed tabs are archived
- Image support — paste or attach images to prompts
- Working directory picker — point each tab at a different project
- Slash command discovery — loads commands from `~/.claude/commands/`, project `.claude/commands/`, and installed plugins
- Model/effort selection per tab (opus, sonnet, haiku / max, high, low)
- Steering — send follow-up instructions while Claude is still running
- Agent panel — sidebar showing active sub-agent tool calls
- Built-in file editor — CodeMirror 6 with syntax highlighting for 15+ languages
- Change tracker — sidebar showing all code changes per session, grouped by file
- In-chat search — find messages across the conversation (Ctrl+F)
- External editor integration — VS Code, Cursor, Sublime Text, Antigravity, Neovim

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri 2 Window (WebView2, no bundled Chromium) │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │  Svelte 5 Frontend                      │    │
│  │  App.svelte → TabBar, ChatView, InputBar│    │
│  │  Theme: CSS custom properties           │    │
│  └──────────────┬──────────────────────────┘    │
│                 │ Tauri IPC (invoke/listen)      │
│  ┌──────────────▼──────────────────────────┐    │
│  │  Rust Backend                           │    │
│  │  lib.rs  → Tauri commands               │    │
│  │  claude.rs → Process spawn + streaming  │    │
│  └──────────────┬──────────────────────────┘    │
│                 │ spawns                         │
│  ┌──────────────▼──────────────────────────┐    │
│  │  claude CLI (official)                  │    │
│  │  --output-format stream-json            │    │
│  │  --dangerously-skip-permissions         │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Data Flow

1. User types in `InputBar` → frontend calls `invoke("send_prompt", { ... })`
2. Rust spawns `claude -p "prompt" --output-format stream-json [--model X] [--resume Y]`
3. Each JSON line from stdout is parsed and emitted as a `claude-event` Tauri event
4. Frontend's `processClaudeEvent()` updates the reactive message array
5. `ChatView` renders messages; `ToolCallCard` renders tool calls as expandable cards
6. On completion, Rust emits `claude-done`; tab stops spinner

### State Management

- **Reactive state:** Svelte 5 runes (`$state`, `$derived`, `$effect`)
- **Persistence:** `localStorage` for active tabs, session history, and settings
- **Backend state:** `AppState` holds a `HashMap<TabId, ClaudeProcess>` behind a Tokio mutex

## Tech Stack

| Layer     | Technology                | Notes                          |
|-----------|---------------------------|--------------------------------|
| Shell     | Tauri 2                   | Native window, system webview  |
| Backend   | Rust + Tokio              | Async process management       |
| Frontend  | Svelte 5                  | Runes syntax, no SvelteKit     |
| Styling   | CSS custom properties     | Midnight/violet theme          |
| Bundler   | Vite 6                    | Dev server on :1420            |
| Markdown  | marked + highlight.js     | Render assistant messages      |
| Dialog    | @tauri-apps/plugin-dialog | Native folder picker           |

## Key Files

| File                                | Purpose                                    |
|-------------------------------------|--------------------------------------------|
| `src/App.svelte`                    | Main layout: tabs, chat, input, sidebars   |
| `src/app.css`                       | Global theme (CSS vars, midnight palette)  |
| `src/lib/types.ts`                  | All TypeScript types + constants           |
| `src/lib/claude.ts`                 | stream-json event parser → UI state        |
| `src/lib/components/ChatView.svelte`| Scrollable message list with auto-scroll   |
| `src/lib/components/MessageBubble.svelte` | Single message with markdown rendering |
| `src/lib/components/ToolCallCard.svelte`  | Expandable tool call display + diffs   |
| `src/lib/components/InputBar.svelte`| Prompt input, model/effort/permission selectors |
| `src/lib/components/TabBar.svelte`  | Tab strip with new/close/switch            |
| `src/lib/components/SettingsPanel.svelte` | Settings: theme, MCP, hooks, permissions |
| `src/lib/components/AgentPanel.svelte`    | Sub-agent sidebar with live activity   |
| `src/lib/components/SessionManager.svelte`| Archived session browser with search   |
| `src/lib/components/TodoPanel.svelte`     | Task tracking (TodoWrite integration)  |
| `src/lib/components/FileTree.svelte`      | File tree sidebar with diff stats      |
| `src/lib/components/FileEditor.svelte`    | Built-in editor (CodeMirror 6, syntax highlighting) |
| `src/lib/components/ChangeTracker.svelte` | Code change tracker sidebar (per-session diffs) |
| `src/lib/components/DiffView.svelte`      | Unified diff renderer (LCS algorithm)  |
| `src/lib/components/ContextIndicator.svelte` | Context window fill indicator       |
| `src/lib/components/SearchOverlay.svelte` | In-chat message search (Ctrl+F)        |
| `src/lib/components/ShortcutHelp.svelte`  | Keyboard shortcut cheatsheet (Ctrl+/)  |
| `src-tauri/src/lib.rs`             | Tauri commands (send_prompt, stop, steer, settings, file I/O) |
| `src-tauri/src/claude.rs`          | Claude CLI process spawn + streaming       |
| `src-tauri/src/main.rs`            | Entry point                                |

## Dependencies

### Frontend (npm)
- `@tauri-apps/api` ^2 — Tauri IPC bridge
- `@tauri-apps/plugin-dialog` ^2.6 — native dialogs
- `highlight.js` ^11 — syntax highlighting in messages
- `marked` ^17 — markdown rendering
- `codemirror` ^6 — built-in file editor core
- `@codemirror/lang-*` — language support (JS/TS, Rust, Python, Go, C/C++, Java, HTML, CSS, JSON, YAML, SQL, XML, PHP, Sass, Markdown)
- `@codemirror/theme-one-dark` ^6 — dark editor theme
- `svelte` ^5, `vite` ^6, `typescript` ^5 (dev)

### Backend (Cargo)
- `tauri` 2 — app framework
- `tokio` 1 — async runtime (process, io-util, sync)
- `serde` / `serde_json` — serialization
- `uuid` 1 — temp file naming
- `dirs` 6 — home directory resolution
- `tauri-plugin-dialog` 2.6

## Development

```bash
npm install
npm run tauri dev     # Starts Vite dev server + Tauri window
npm run tauri build   # Production build
```

Window config: 1100x750, frameless (custom titlebar), transparent background, WebView2.

## Design Principles

- **Thin wrapper** — clauke does zero AI logic; everything goes through the official CLI
- **Minimal deps** — no unnecessary libraries, no bundled browser engine
- **Dark aesthetic** — "midnight cloak" theme with deep purples, violets, glass effects
- **Svelte 5 idioms** — runes ($state, $derived, $effect, $props), no legacy stores
- **Per-tab isolation** — each tab is an independent Claude session with its own cwd/model/history
