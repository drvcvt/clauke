# clauke

Claude Code Wrapper — a beautiful cloak around Claude Code CLI.

## What this is

A lightweight Tauri 2 desktop app that wraps the `claude` CLI. It does NOT reimplement
any Claude functionality — it simply spawns `claude --output-format stream-json`
(with configurable permission mode) and renders the streaming JSON events in a nice UI.

## Tech Stack

- **Tauri 2** — native desktop shell, uses system webview (low memory)
- **Rust** backend — spawns `claude` CLI, pipes stream-json to frontend
- **Svelte 5** frontend — renders events as chat UI with tool call cards
- **No bundled Chromium** — uses Windows WebView2

## Project Structure

```
src/                    # Svelte frontend
  App.svelte            # Main app layout (tabs + chat + input + sidebars)
  app.css               # Global styles (midnight/cloak theme, light/dark)
  lib/
    types.ts            # TypeScript types, constants, utility functions
    claude.ts           # Event parser (stream-json → UI state, agent tracking)
    components/
      ChatView.svelte       # Scrollable message list with auto-scroll
      MessageBubble.svelte  # Single message (user/assistant) with markdown
      ToolCallCard.svelte   # Expandable tool call display with diff view
      InputBar.svelte       # Prompt input, model/effort/permission selectors
      TabBar.svelte         # Tab strip with new/close/switch
      SettingsPanel.svelte  # Settings: theme, MCP servers, hooks, permissions
      SessionManager.svelte # Archived session browser with search
      TodoPanel.svelte      # Task tracking panel (TodoWrite integration)
      FileTree.svelte       # File tree sidebar with diff stats
      FileEditor.svelte     # Built-in file editor (CodeMirror 6, syntax highlighting)
      ChangeTracker.svelte  # Code change tracker sidebar (per-session file diffs)
      AgentPanel.svelte     # Sub-agent sidebar with live activity tracking
      DiffView.svelte       # Unified diff renderer (LCS algorithm)
      ContextIndicator.svelte # Context window fill indicator
      SearchOverlay.svelte  # In-chat message search (Ctrl+F)
      ShortcutHelp.svelte   # Keyboard shortcut cheatsheet modal (Ctrl+/)
src-tauri/              # Rust backend
  src/
    main.rs             # Entry point
    lib.rs              # Tauri commands (send_prompt, stop, steer, settings, file I/O)
    claude.rs           # Claude CLI process management
```

## Running

```bash
npm install
npm run tauri dev
```

## Architecture

1. User types prompt in InputBar (supports images, slash commands, model/effort selection)
2. Frontend calls Rust `send_prompt` command via Tauri IPC
3. Rust spawns `claude -p "prompt" --output-format stream-json [--model X] [--resume Y]`
4. Each JSON line from stdout is emitted as a `claude-event` Tauri event
5. Frontend's `processClaudeEvent()` parses events into reactive message state
6. Thinking blocks render as collapsible sections (collapsed by default with preview)
7. Tool calls render as collapsible cards; Agent tool calls track nested sub-agent activity
8. Multi-tab sessions persist to localStorage; closed tabs are archived

## Event Types

The stream-json format from Claude CLI produces these event types, all handled in `claude.ts`:

| Event type | Description |
|---|---|
| `system` | Init or auto-compact notifications |
| `assistant` | Text, thinking, or tool_use content blocks |
| `content_block_start` | Streaming start for text, thinking, or tool_use blocks |
| `content_block_delta` | Streaming deltas: `text_delta`, `thinking_delta`, `input_json_delta` |
| `content_block_stop` | End of a streaming content block |
| `tool_result` / `tool` | Tool execution results |
| `result` | Final completion or tool result with usage stats |
| `error` | Error messages |
| `raw` | Non-JSON output (fallback) |

### Thinking blocks

Claude's extended thinking (`thinking` content blocks) are parsed from three sources:
- `assistant` events with `message.type === "thinking"`
- `content_block_start` with `content_block.type === "thinking"`
- `content_block_delta` with `delta.type === "thinking_delta"`

They render as collapsible sections in `MessageBubble.svelte` — collapsed by default
with an 80-char preview, expandable to show full markdown-rendered thinking with a
400px max-height scrollable area. Thinking blocks are truncated to 500 chars for
localStorage persistence.

## Conventions

- Svelte 5 runes syntax ($state, $derived, $props, $effect)
- Dark "midnight cloak" theme — deep purples and violets
- Minimal dependencies — no unnecessary libraries
- All Claude interaction goes through the CLI, never direct API calls
