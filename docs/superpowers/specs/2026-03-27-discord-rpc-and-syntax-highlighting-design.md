# Discord Rich Presence + Extended Syntax Highlighting

## Overview

Two independent features for clauke:

1. **Discord RPC** — Show live session stats (model, activity, duration) in Discord's Rich Presence
2. **Extended syntax highlighting** — Add Lua, TOML, Dockerfile, PowerShell, Zig, and Haskell to the code renderer

---

## Feature 1: Discord Rich Presence

### What it shows

| Field | Value | Example |
|-------|-------|---------|
| Details | "Using {Model}" | "Using Opus" |
| State | Current activity | "Thinking..." / "Running Bash" / "Idle" |
| Timestamp | Session start (Discord renders as elapsed) | "02:34 elapsed" |
| Large image | clauke icon | Application logo |

### Architecture

**Rust backend** owns the Discord IPC connection. Frontend sends state updates via Tauri commands.

```
Frontend (Svelte)                    Backend (Rust)
─────────────────                    ──────────────
InputBar sends prompt ──►  send_prompt (existing)
                                     │
App.svelte tracks model,  ──►  update_discord_rpc(model, activity, message_count)
activity, message count              │
                                     DiscordIpcClient.set_activity(...)
Settings toggle ──────────►  toggle_discord_rpc(enabled: bool)
                                     │
                                     Connect/disconnect IPC
```

### Rust implementation

**Crate**: `discord-rich-presence` (add to Cargo.toml)

**State**: Add `discord_client: Option<DiscordIpcClient>` to `AppState` (behind a Mutex).

**Commands**:
- `toggle_discord_rpc(enabled: bool)` — Connect or disconnect the IPC client. Persist preference via `storage_write`.
- `update_discord_rpc(model: String, activity: String, message_count: u32)` — Update the presence fields. No-op if RPC is disabled.

**Lifecycle**:
- On app startup: read `discord_rpc_enabled` from storage. If true, connect.
- On app close: client drops automatically, Discord clears presence.
- If Discord is not running: connection fails silently, no error shown to user.

### Frontend integration

**App.svelte**: Call `update_discord_rpc` whenever model, activity state, or message count changes. Debounce to avoid flooding (e.g., don't update on every thinking delta — update on state transitions: idle→thinking, thinking→tool, tool→idle).

**SettingsPanel.svelte**: Add a "Discord Rich Presence" toggle. On change, call `toggle_discord_rpc`. Read initial state from storage on mount.

### Discord Application

Requires a Discord Application ID. Create one at discord.com/developers with the app name "clauke". The application ID is a constant compiled into the binary.

---

## Feature 2: Extended Syntax Highlighting

### Current state

`MessageBubble.svelte` imports `highlight.js/lib/common` which includes 33 languages (including C++, Python, Rust, TypeScript, etc.).

### Languages to add

Lua, TOML, Dockerfile, PowerShell, Zig, Haskell

### Implementation

In `MessageBubble.svelte`, after the `hljs` import, register each additional language:

```typescript
import hljs from "highlight.js/lib/common";
import lua from "highlight.js/lib/languages/lua";
import toml from "highlight.js/lib/languages/ini";       // TOML uses ini grammar
import dockerfile from "highlight.js/lib/languages/dockerfile";
import powershell from "highlight.js/lib/languages/powershell";
import zig from "highlight.js/lib/languages/zig";
import haskell from "highlight.js/lib/languages/haskell";

hljs.registerLanguage("lua", lua);
hljs.registerLanguage("toml", toml);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("zig", zig);
hljs.registerLanguage("haskell", haskell);
```

No other changes needed. The existing `hljs.getLanguage(language)` check and `hljs.highlight()` call already handle registered languages.

### Bundle impact

Each language grammar is ~2-8KB minified. Total addition: ~25KB uncompressed, ~8KB gzipped. Negligible.

---

## Files to modify

| File | Feature | Change |
|------|---------|--------|
| `src-tauri/Cargo.toml` | RPC | Add `discord-rich-presence` dependency |
| `src-tauri/src/lib.rs` | RPC | Add Discord state to AppState, add `toggle_discord_rpc` and `update_discord_rpc` commands, register in handler |
| `src/App.svelte` | RPC | Call `update_discord_rpc` on state transitions |
| `src/lib/components/SettingsPanel.svelte` | RPC | Add Discord RPC toggle |
| `src/lib/components/MessageBubble.svelte` | Highlighting | Register additional hljs languages |

## Verification

### Discord RPC
1. Open Discord, then launch clauke
2. Check Discord profile — should show "Using clauke" with model and activity
3. Send a prompt — activity should update to "Thinking..." then back to "Idle"
4. Toggle off in settings — presence should clear from Discord
5. Restart app — toggle state should persist

### Syntax highlighting
1. Send a prompt that produces Lua, TOML, Zig, or Haskell code blocks
2. Verify syntax coloring appears correctly
3. Verify existing languages (Python, Rust, etc.) still work
