<script lang="ts">
  import { getCurrentWindow, Effect, EffectState } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { ClaudeModel, EffortLevel, PermissionMode, McpServer, McpServerType, HookRule } from "../types";
  import { MODEL_LABELS, EFFORT_LABELS, PERMISSION_LABELS, HOOK_EVENTS, HOOK_EVENT_LABELS } from "../types";
  import type { HookEvent } from "../types";

  let {
    open: isOpen,
    onClose,
    onSettingsChange,
  }: {
    open: boolean;
    onClose: () => void;
    onSettingsChange: (settings: Record<string, string>) => void;
  } = $props();

  let visible = $state(false);
  let closing = $state(false);

  const appWindow = getCurrentWindow();

  // ── Persisted settings ──
  let theme = $state<"dark" | "light">(
    (localStorage.getItem("clauke:theme") as "dark" | "light") || "dark",
  );
  let transparency = $state(
    localStorage.getItem("clauke:transparency") !== "false",
  );
  let defaultModel = $state<ClaudeModel>(
    (localStorage.getItem("clauke:defaultModel") as ClaudeModel) || "opus",
  );
  let defaultEffort = $state<EffortLevel>(
    (localStorage.getItem("clauke:defaultEffort") as EffortLevel) || "max",
  );
  let defaultCwd = $state(localStorage.getItem("clauke:defaultCwd") || "");
  let fontSize = $state(
    parseInt(localStorage.getItem("clauke:fontSize") || "14", 10),
  );
  let autoScroll = $state(
    localStorage.getItem("clauke:autoScroll") !== "false",
  );
  let permissionMode = $state<PermissionMode>(
    (localStorage.getItem("clauke:permissionMode") as PermissionMode) || "bypass",
  );
  let systemPrompt = $state(
    localStorage.getItem("clauke:systemPrompt") || "",
  );
  let clipboardRetention = $state(
    parseInt(localStorage.getItem("clauke:clipboardRetention") || "7", 10),
  );
  let lastCleanupResult = $state<string | null>(null);

  // ── Help tooltips ──
  let helpVisible = $state(false);
  let helpText = $state("");
  let helpPos = $state({ x: 0, y: 0 });
  let helpTimer: ReturnType<typeof setTimeout> | null = null;

  const helpContent: Record<string, string> = {
    cli: "clauke needs the Claude Code CLI to work.\n\nInstall it via npm:\n  npm install -g @anthropic-ai/claude-code\n\nThen run 'claude' once in a terminal to authenticate.\n\nIf the status shows a red X, Claude CLI is not in your PATH. Either:\n  1. Restart clauke after installing\n  2. Set the full path below (e.g. C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd)\n\nClick 'verify' to re-check after changes.",
    mcp: "MCP (Model Context Protocol) servers extend Claude with custom tools.\n\nServer types:\n  stdio — runs a local command (e.g. npx, node, python)\n  http — connects to an HTTP MCP endpoint\n  sse — connects to a Server-Sent Events endpoint\n\nExamples:\n  stdio: name=filesystem, command=npx, args=-y @anthropic/mcp-filesystem\n  http: name=ida-pro, url=http://127.0.0.1:13337/mcp",
    hooks: "Hooks run shell commands at specific points in Claude's lifecycle.\n\nEvents:\n  PreToolUse — before a tool runs\n  PostToolUse — after a tool runs\n  SessionStart/End — session lifecycle\n  Stop — when Claude finishes\n\nMatcher is a regex to filter tool names (e.g. Edit|Write).",
  };

  function showHelp(target: EventTarget | null, key: string) {
    if (helpTimer) clearTimeout(helpTimer);
    helpTimer = setTimeout(() => {
      helpText = helpContent[key] || "";
      if (target && target instanceof HTMLElement) {
        const rect = target.getBoundingClientRect();
        const maxX = window.innerWidth - 576;
        helpPos = { x: Math.max(8, Math.min(rect.left, maxX)), y: rect.bottom + 6 };
      }
      helpVisible = true;
    }, 800);
  }

  function hideHelp() {
    if (helpTimer) { clearTimeout(helpTimer); helpTimer = null; }
    helpVisible = false;
  }

  // ── Claude CLI ──
  let claudePath = $state(localStorage.getItem("clauke:claudePath") || "");
  let cliStatus = $state<"unknown" | "checking" | "ok" | "error">("unknown");
  let cliVersion = $state("");
  let cliError = $state("");

  async function checkCli() {
    cliStatus = "checking";
    try {
      const version = await invoke<string>("check_claude_cli", {
        customPath: claudePath || null,
      });
      cliVersion = version;
      cliStatus = "ok";
    } catch (e) {
      cliError = String(e);
      cliStatus = "error";
    }
  }

  function saveClaudePath() {
    localStorage.setItem("clauke:claudePath", claudePath);
    checkCli();
  }

  // ── Editor ──
  interface EditorEntry { id: string; name: string; command: string; }

  /** All supported editors — always shown, detected ones get a checkmark */
  const ALL_EDITORS: EditorEntry[] = [
    { id: "vscode", name: "VS Code", command: "code" },
    { id: "cursor", name: "Cursor", command: "cursor" },
    { id: "sublime", name: "Sublime Text", command: "subl" },
    { id: "antigravity", name: "Antigravity", command: "antigravity" },
    { id: "neovim", name: "Neovim", command: "nvim" },
  ];

  let detectedEditorIds = $state<Set<string>>(new Set());
  let editorLoading = $state(false);
  let selectedEditor = $state(localStorage.getItem("clauke:editor") || "vscode");

  async function loadEditors() {
    editorLoading = true;
    try {
      const detected = await invoke<EditorEntry[]>("detect_editors");
      detectedEditorIds = new Set(detected.map(e => e.id));
    } catch {
      detectedEditorIds = new Set();
    }
    editorLoading = false;
  }

  // Sync open prop to visible with close animation
  $effect(() => {
    if (isOpen && !visible) {
      closing = false;
      visible = true;
    } else if (!isOpen && visible && !closing) {
      closing = true;
      setTimeout(() => {
        visible = false;
        closing = false;
      }, 200);
    }
  });

  function handleClose() {
    closing = true;
    setTimeout(() => {
      visible = false;
      closing = false;
      onClose();
    }, 200);
  }

  function save(key: string, value: string) {
    localStorage.setItem(`clauke:${key}`, value);
    emitAll();
  }

  function emitAll() {
    onSettingsChange({
      defaultModel,
      defaultEffort,
      defaultCwd,
      fontSize: String(fontSize),
      autoScroll: String(autoScroll),
      permissionMode,
      systemPrompt,
    });
  }

  // ── Transparency (special — needs window API) ──
  async function applyTransparency(enabled: boolean) {
    localStorage.setItem("clauke:transparency", String(enabled));
    document.documentElement.classList.toggle("transparent", enabled);

    if (enabled) {
      await appWindow.setEffects({
        effects: [Effect.Acrylic],
        state: EffectState.Active,
        color: "#0b0b0e00",
      });
    } else {
      await appWindow.clearEffects();
    }
  }

  function toggleTransparency() {
    transparency = !transparency;
    applyTransparency(transparency);
  }

  // ── Theme ──
  function applyTheme(t: "dark" | "light") {
    document.documentElement.setAttribute("data-theme", t);
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    save("theme", theme);
    applyTheme(theme);
  }

  // ── Font size ──
  function setFontSize(size: number) {
    fontSize = Math.max(10, Math.min(22, size));
    save("fontSize", String(fontSize));
    document.documentElement.style.setProperty("--chat-font-size", `${fontSize}px`);
  }

  // ── Toggle helpers ──
  function toggleAutoScroll() {
    autoScroll = !autoScroll;
    save("autoScroll", String(autoScroll));
  }

  // ── Discord RPC ──
  let discordRpcEnabled = $state(true);

  async function loadDiscordRpcState() {
    try {
      discordRpcEnabled = await invoke<boolean>("get_discord_rpc_enabled");
    } catch {
      discordRpcEnabled = true;
    }
  }

  async function toggleDiscordRpc() {
    discordRpcEnabled = !discordRpcEnabled;
    try {
      await invoke("toggle_discord_rpc", { enabled: discordRpcEnabled });
    } catch {
      // Discord not running — toggle still persists preference
    }
  }

  const permModes: PermissionMode[] = ["bypass", "acceptEdits", "plan", "default"];

  function cyclePermissionMode() {
    const idx = permModes.indexOf(permissionMode);
    permissionMode = permModes[(idx + 1) % permModes.length];
    save("permissionMode", permissionMode);
  }

  // ── Model/Effort selectors ──
  function cycleModel() {
    const models: ClaudeModel[] = ["sonnet", "opus", "haiku"];
    const idx = models.indexOf(defaultModel);
    defaultModel = models[(idx + 1) % models.length];
    save("defaultModel", defaultModel);
  }

  function cycleEffort() {
    const levels: EffortLevel[] = ["low", "medium", "high", "max"];
    const idx = levels.indexOf(defaultEffort);
    defaultEffort = levels[(idx + 1) % levels.length];
    save("defaultEffort", defaultEffort);
  }

  // ── Browse default CWD ──
  async function browseCwd() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      defaultCwd = selected as string;
      save("defaultCwd", defaultCwd);
    }
  }

  // ── Clipboard retention ──
  function setClipboardRetention(days: number) {
    clipboardRetention = Math.max(1, Math.min(365, days));
    save("clipboardRetention", String(clipboardRetention));
  }

  async function runCleanupNow() {
    try {
      const deleted = await invoke<number>("cleanup_clipboard", { maxAgeDays: clipboardRetention });
      lastCleanupResult = deleted > 0 ? `${deleted} file${deleted > 1 ? "s" : ""} deleted` : "nothing to clean";
      setTimeout(() => (lastCleanupResult = null), 3000);
    } catch (e) {
      lastCleanupResult = "cleanup failed";
      setTimeout(() => (lastCleanupResult = null), 3000);
    }
  }

  // ── MCP Servers ──
  let mcpServers = $state<McpServer[]>([]);
  let mcpLoading = $state(false);
  let mcpAddOpen = $state(false);
  let mcpNewName = $state("");
  let mcpNewType = $state<McpServerType>("stdio");
  let mcpNewCommand = $state("");
  let mcpNewArgs = $state("");
  let mcpNewUrl = $state("");

  // Health check state
  type HealthStatus = "unknown" | "checking" | "healthy" | "unhealthy";
  let mcpHealth = $state<Record<string, HealthStatus>>({});
  let mcpHealthErrors = $state<Record<string, string>>({});

  async function loadMcpServers() {
    mcpLoading = true;
    try {
      mcpServers = await invoke<McpServer[]>("list_mcp_servers");
    } catch {
      mcpServers = [];
    }
    mcpLoading = false;
  }

  async function addMcpServer() {
    const name = mcpNewName.trim();
    if (!name) return;

    try {
      if (mcpNewType === "stdio") {
        const command = mcpNewCommand.trim();
        if (!command) return;
        const args = mcpNewArgs.trim() ? mcpNewArgs.trim().split(/\s+/) : [];
        await invoke("add_mcp_server", {
          name, serverType: "stdio", command, args, env: {}, url: null,
        });
      } else {
        const url = mcpNewUrl.trim();
        if (!url) return;
        await invoke("add_mcp_server", {
          name, serverType: mcpNewType, command: null, args: null, env: null, url,
        });
      }
      mcpNewName = "";
      mcpNewType = "stdio";
      mcpNewCommand = "";
      mcpNewArgs = "";
      mcpNewUrl = "";
      mcpAddOpen = false;
      await loadMcpServers();
    } catch { /* silently fail */ }
  }

  async function removeMcpServer(name: string) {
    try {
      await invoke("remove_mcp_server", { name });
      delete mcpHealth[name];
      delete mcpHealthErrors[name];
      await loadMcpServers();
    } catch { /* silently fail */ }
  }

  async function checkMcpHealth(server: McpServer) {
    mcpHealth[server.name] = "checking";
    try {
      const result = await invoke<{ name: string; healthy: boolean; error: string | null }>(
        "check_mcp_server",
        {
          name: server.name,
          serverType: server.type,
          command: server.command ?? null,
          url: server.url ?? null,
        },
      );
      mcpHealth[result.name] = result.healthy ? "healthy" : "unhealthy";
      if (result.error) mcpHealthErrors[result.name] = result.error;
      else delete mcpHealthErrors[result.name];
    } catch {
      mcpHealth[server.name] = "unhealthy";
    }
  }

  function checkAllMcpHealth() {
    for (const server of mcpServers) {
      checkMcpHealth(server);
    }
  }

  // ── Hooks ──
  let hooksConfig = $state<Record<string, HookRule[]>>({});
  let hooksLoading = $state(false);
  let hookAddOpen = $state(false);
  let hookNewEvent = $state<HookEvent>("PostToolUse");
  let hookNewMatcher = $state("");
  let hookNewCommand = $state("");

  async function loadHooks() {
    hooksLoading = true;
    try {
      hooksConfig = await invoke<Record<string, HookRule[]>>("list_hooks");
    } catch {
      hooksConfig = {};
    }
    hooksLoading = false;
  }

  async function addHook() {
    const command = hookNewCommand.trim();
    if (!command) return;
    const matcher = hookNewMatcher.trim() || ".*";
    try {
      await invoke("add_hook", { event: hookNewEvent, matcher, command });
      hookNewCommand = "";
      hookNewMatcher = "";
      hookAddOpen = false;
      await loadHooks();
    } catch { /* silently fail */ }
  }

  async function removeHook(event: string, index: number) {
    try {
      await invoke("remove_hook", { event, index });
      await loadHooks();
    } catch { /* silently fail */ }
  }

  const hookEntries = $derived(
    Object.entries(hooksConfig).flatMap(([event, rules]) =>
      rules.map((rule, idx) => ({ event, rule, idx }))
    )
  );

  // Apply saved settings on first render
  document.documentElement.style.setProperty("--chat-font-size", `${fontSize}px`);
  applyTheme(theme);
  applyTransparency(transparency);
  // Emit initial settings
  emitAll();

  // Load MCP servers, hooks, editors, and CLI status when panel opens
  $effect(() => {
    if (isOpen) {
      loadMcpServers().then(() => checkAllMcpHealth());
      loadHooks();
      loadEditors();
      checkCli();
      loadDiscordRpcState();
    }
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="overlay"
    class:closing
    onclick={handleClose}
    onkeydown={(e) => e.key === "Escape" && handleClose()}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="panel" class:closing onclick={(e) => e.stopPropagation()}>
      <div class="panel-header">
        <span class="panel-title">settings</span>
        <button class="close-btn" title="Close" onclick={handleClose}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>

      <div class="sections">
        <!-- ── Claude CLI ── -->
        <div class="section">
          <div class="section-title">
            claude cli
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="help-trigger" onmouseenter={(e) => showHelp(e.currentTarget, 'cli')} onmouseleave={hideHelp}>?</span>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">status</span>
              <span class="desc">
                {#if cliStatus === "checking"}
                  checking...
                {:else if cliStatus === "ok"}
                  {cliVersion}
                {:else if cliStatus === "error"}
                  {cliError}
                {:else}
                  not checked yet
                {/if}
              </span>
            </div>
            <div class="cli-status">
              {#if cliStatus === "ok"}
                <span class="cli-ok" title="Claude CLI found">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              {:else if cliStatus === "error"}
                <span class="cli-err" title="Claude CLI not found">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
              {:else if cliStatus === "checking"}
                <span class="cli-checking"></span>
              {/if}
            </div>
          </div>

          <div class="row-col">
            <div class="label-group">
              <span class="label">custom path</span>
              <span class="desc">leave empty to use "claude" from PATH</span>
            </div>
            <div class="cli-path-row">
              <input
                class="mcp-input"
                placeholder="claude"
                bind:value={claudePath}
                onblur={saveClaudePath}
                onkeydown={(e) => { if (e.key === 'Enter') saveClaudePath(); }}
              />
              <button class="pill" onclick={checkCli}>verify</button>
            </div>
          </div>
        </div>

        <!-- ── Appearance ── -->
        <div class="section">
          <div class="section-title">appearance</div>

          <div class="row">
            <div class="label-group">
              <span class="label">theme</span>
              <span class="desc">{theme === "dark" ? "midnight cloak" : "daylight"}</span>
            </div>
            <button class="pill" onclick={toggleTheme}>{theme}</button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">transparency</span>
              <span class="desc">frosted glass with desktop blur</span>
            </div>
            <button
              class="toggle"
              class:active={transparency}
              title="Toggle transparency"
              onclick={toggleTransparency}
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">font size</span>
              <span class="desc">chat text size ({fontSize}px)</span>
            </div>
            <div class="stepper">
              <button class="step-btn" onclick={() => setFontSize(fontSize - 1)} title="Decrease font size">-</button>
              <span class="step-value">{fontSize}</span>
              <button class="step-btn" onclick={() => setFontSize(fontSize + 1)} title="Increase font size">+</button>
            </div>
          </div>
        </div>

        <!-- ── Defaults ── -->
        <div class="section">
          <div class="section-title">defaults for new tabs</div>

          <div class="row">
            <div class="label-group">
              <span class="label">model</span>
              <span class="desc">default model for new tabs</span>
            </div>
            <button class="pill" onclick={cycleModel}>{MODEL_LABELS[defaultModel]}</button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">effort</span>
              <span class="desc">default effort level</span>
            </div>
            <button class="pill" onclick={cycleEffort}>{EFFORT_LABELS[defaultEffort]}</button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">working directory</span>
              <span class="desc">{defaultCwd || "none set"}</span>
            </div>
            <button class="pill" onclick={browseCwd}>browse</button>
          </div>
        </div>

        <!-- ── Behavior ── -->
        <div class="section">
          <div class="section-title">behavior</div>

          <div class="row">
            <div class="label-group">
              <span class="label">auto-scroll</span>
              <span class="desc">follow new content during streaming</span>
            </div>
            <button
              class="toggle"
              class:active={autoScroll}
              title="Toggle auto-scroll"
              onclick={toggleAutoScroll}
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
        </div>

        <!-- ── Discord RPC ── -->
        <div class="section">
          <div class="section-title">integrations</div>

          <div class="row">
            <div class="label-group">
              <span class="label">discord rich presence</span>
              <span class="desc">show session stats in your Discord profile</span>
            </div>
            <button
              class="toggle"
              class:active={discordRpcEnabled}
              title="Toggle Discord Rich Presence"
              onclick={toggleDiscordRpc}
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
        </div>

        <!-- ── Editor ── -->
        <div class="section">
          <div class="section-title">editor</div>

          <div class="row">
            <div class="label-group">
              <span class="label">preferred editor</span>
              <span class="desc">middle-click files in explorer to open</span>
            </div>
            {#if editorLoading}
              <span class="desc" style="flex-shrink:0">detecting...</span>
            {:else}
              <button class="pill" onclick={() => {
                const ids = ALL_EDITORS.map(e => e.id);
                const idx = ids.indexOf(selectedEditor);
                selectedEditor = ids[(idx + 1) % ids.length];
                save("editor", selectedEditor);
              }}>
                {ALL_EDITORS.find(e => e.id === selectedEditor)?.name || selectedEditor}
                {#if detectedEditorIds.has(selectedEditor)}
                  <span style="opacity:0.5; margin-left:2px">*</span>
                {/if}
              </button>
            {/if}
          </div>
        </div>

        <!-- ── Permissions ── -->
        <div class="section">
          <div class="section-title">permissions</div>

          <div class="row">
            <div class="label-group">
              <span class="label">default mode</span>
              <span class="desc">{PERMISSION_LABELS[permissionMode]} — default for new tabs</span>
            </div>
            <button class="pill" onclick={cyclePermissionMode}>{PERMISSION_LABELS[permissionMode]}</button>
          </div>
        </div>

        <!-- ── MCP Servers ── -->
        <div class="section">
          <div class="section-title">
            mcp servers
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="help-trigger" onmouseenter={(e) => showHelp(e.currentTarget, 'mcp')} onmouseleave={hideHelp}>?</span>
            {#if mcpServers.length > 0}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="mcp-refresh" onclick={checkAllMcpHealth} title="Refresh status">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
              </span>
            {/if}
          </div>

          {#if mcpLoading}
            <div class="mcp-empty">loading…</div>
          {:else if mcpServers.length === 0 && !mcpAddOpen}
            <div class="mcp-empty">no servers configured</div>
          {:else}
            {#each mcpServers as server}
              <div class="mcp-row">
                <span
                  class="mcp-status-dot"
                  class:healthy={mcpHealth[server.name] === "healthy"}
                  class:unhealthy={mcpHealth[server.name] === "unhealthy"}
                  class:checking={mcpHealth[server.name] === "checking"}
                  title={mcpHealthErrors[server.name] || (mcpHealth[server.name] === "healthy" ? "connected" : mcpHealth[server.name] === "checking" ? "checking…" : "unknown")}
                ></span>
                <div class="mcp-info">
                  <span class="mcp-name">{server.name}</span>
                  <span class="mcp-cmd">
                    {#if server.type === "http" || server.type === "sse"}
                      {server.type}: {server.url}
                    {:else}
                      {server.command} {server.args?.join(" ") ?? ""}
                    {/if}
                  </span>
                </div>
                <button
                  class="mcp-remove"
                  onclick={() => removeMcpServer(server.name)}
                  title="Remove {server.name}"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
                    <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
                  </svg>
                </button>
              </div>
            {/each}
          {/if}

          {#if mcpAddOpen}
            <div class="mcp-add-form">
              <input class="mcp-input" placeholder="name" bind:value={mcpNewName} />
              <select class="mcp-input" bind:value={mcpNewType}>
                <option value="stdio">stdio (command)</option>
                <option value="http">http (url)</option>
                <option value="sse">sse (url)</option>
              </select>
              {#if mcpNewType === "stdio"}
                <input class="mcp-input" placeholder="command (e.g. npx)" bind:value={mcpNewCommand} />
                <input class="mcp-input" placeholder="args (space separated)" bind:value={mcpNewArgs} />
              {:else}
                <input class="mcp-input" placeholder="url (e.g. http://127.0.0.1:8080/mcp)" bind:value={mcpNewUrl} />
              {/if}
              <div class="mcp-add-actions">
                <button class="pill" onclick={addMcpServer}>add</button>
                <button class="pill" onclick={() => (mcpAddOpen = false)}>cancel</button>
              </div>
            </div>
          {:else}
            <div class="row" style="justify-content: flex-end; padding-top: 4px;">
              <button class="pill" onclick={() => (mcpAddOpen = true)}>+ add server</button>
            </div>
          {/if}
        </div>

        <!-- ── Hooks ── -->
        <div class="section">
          <div class="section-title">
            hooks
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="help-trigger" onmouseenter={(e) => showHelp(e.currentTarget, 'hooks')} onmouseleave={hideHelp}>?</span>
          </div>

          {#if hooksLoading}
            <div class="mcp-empty">loading…</div>
          {:else if hookEntries.length === 0 && !hookAddOpen}
            <div class="mcp-empty">no hooks configured</div>
          {:else}
            {#each hookEntries as { event, rule, idx }}
              <div class="hook-row">
                <div class="hook-info">
                  <div class="hook-header">
                    <span class="hook-event">{event}</span>
                    {#if rule.matcher !== ".*"}
                      <span class="hook-matcher">{rule.matcher}</span>
                    {/if}
                  </div>
                  {#each rule.hooks as action}
                    <span class="hook-cmd">{action.command}</span>
                  {/each}
                </div>
                <button
                  class="mcp-remove"
                  onclick={() => removeHook(event, idx)}
                  title="Remove hook"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
                    <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
                  </svg>
                </button>
              </div>
            {/each}
          {/if}

          {#if hookAddOpen}
            <div class="mcp-add-form">
              <select class="hook-select" bind:value={hookNewEvent}>
                {#each HOOK_EVENTS as ev}
                  <option value={ev}>{HOOK_EVENT_LABELS[ev]}</option>
                {/each}
              </select>
              <input class="mcp-input" placeholder="matcher (regex, e.g. Edit|Write)" bind:value={hookNewMatcher} />
              <input class="mcp-input" placeholder="shell command" bind:value={hookNewCommand} />
              <div class="mcp-add-actions">
                <button class="pill" onclick={addHook}>add</button>
                <button class="pill" onclick={() => (hookAddOpen = false)}>cancel</button>
              </div>
            </div>
          {:else}
            <div class="row" style="justify-content: flex-end; padding-top: 4px;">
              <button class="pill" onclick={() => (hookAddOpen = true)}>+ add hook</button>
            </div>
          {/if}
        </div>

        <!-- ── Advanced ── -->
        <div class="section">
          <div class="section-title">advanced</div>

          <div class="row-col">
            <div class="label-group">
              <span class="label">system prompt</span>
              <span class="desc">default for new tabs (per-tab override in input bar)</span>
            </div>
            <textarea
              class="sys-prompt"
              placeholder="e.g. Always respond in German..."
              bind:value={systemPrompt}
              onblur={() => save("systemPrompt", systemPrompt)}
            ></textarea>
          </div>
        </div>

        <!-- ── Storage ── -->
        <div class="section">
          <div class="section-title">storage</div>

          <div class="row">
            <div class="label-group">
              <span class="label">clipboard retention</span>
              <span class="desc">delete pasted images after {clipboardRetention}d</span>
            </div>
            <div class="stepper">
              <button class="step-btn" onclick={() => setClipboardRetention(clipboardRetention - 1)} title="Decrease">-</button>
              <span class="step-value">{clipboardRetention}</span>
              <button class="step-btn" onclick={() => setClipboardRetention(clipboardRetention + 1)} title="Increase">+</button>
            </div>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">clean up now</span>
              <span class="desc">{lastCleanupResult || "remove old clipboard images"}</span>
            </div>
            <button class="pill" onclick={runCleanupNow}>clean</button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if helpVisible}
  <div class="help-tooltip" style="left: {helpPos.x}px; top: {helpPos.y}px;">
    <pre class="help-text">{helpText}</pre>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 48px 16px;
    background: rgba(0, 0, 0, 0);
    animation: overlayIn 0.25s var(--ease-out-expo) forwards;
  }

  .overlay.closing {
    animation: overlayOut 0.2s var(--ease-in-out) forwards;
  }

  @keyframes overlayIn {
    from { background: rgba(0, 0, 0, 0); }
    to { background: rgba(0, 0, 0, 0.15); }
  }

  @keyframes overlayOut {
    from { background: rgba(0, 0, 0, 0.15); }
    to { background: rgba(0, 0, 0, 0); }
  }

  .panel {
    --panel-bg: rgba(255, 255, 255, 0.06);
    --panel-header-bg: rgba(255, 255, 255, 0.08);
    --panel-border: rgba(255, 255, 255, 0.1);
    --panel-divider: rgba(255, 255, 255, 0.06);
    --panel-hover: rgba(255, 255, 255, 0.06);
    --panel-control-bg: rgba(255, 255, 255, 0.04);
    --panel-control-active: rgba(255, 255, 255, 0.12);
    --panel-control-active-border: rgba(255, 255, 255, 0.18);
    --panel-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
    --panel-inset: inset 0 1px 0 rgba(255, 255, 255, 0.06);

    width: 300px;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    background: var(--panel-bg);
    backdrop-filter: var(--glass-panel-blur);
    -webkit-backdrop-filter: var(--glass-panel-blur);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    box-shadow: var(--panel-shadow), var(--panel-inset);
    animation: panelIn 0.3s var(--ease-out-expo) forwards;
    transform-origin: top right;
  }

  :global(html.transparent) .panel {
    --panel-bg: rgba(255, 255, 255, 0.05);
    --panel-header-bg: rgba(255, 255, 255, 0.06);
  }

  :global([data-theme="light"].transparent) .panel {
    --panel-bg: rgba(0, 0, 0, 0.05);
    --panel-header-bg: rgba(0, 0, 0, 0.06);
  }

  :global([data-theme="light"]) .panel {
    --panel-bg: rgba(255, 255, 255, 0.45);
    --panel-header-bg: rgba(255, 255, 255, 0.5);
    --panel-border: rgba(0, 0, 0, 0.1);
    --panel-divider: rgba(0, 0, 0, 0.06);
    --panel-hover: rgba(0, 0, 0, 0.04);
    --panel-control-bg: rgba(0, 0, 0, 0.04);
    --panel-control-active: rgba(0, 0, 0, 0.1);
    --panel-control-active-border: rgba(0, 0, 0, 0.18);
    --panel-shadow: 0 8px 40px rgba(0, 0, 0, 0.1);
    --panel-inset: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  .panel.closing {
    animation: panelOut 0.2s var(--ease-in-out) forwards;
  }

  @keyframes panelIn {
    from {
      opacity: 0;
      transform: translateY(-12px) scale(0.92);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes panelOut {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(-8px) scale(0.95);
    }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--panel-divider);
    position: sticky;
    top: 0;
    background: var(--panel-header-bg);
    backdrop-filter: var(--glass-panel-blur);
    -webkit-backdrop-filter: var(--glass-panel-blur);
    z-index: 1;
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
  }

  .close-btn {
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
  }
  .close-btn:hover {
    color: var(--text-secondary);
    background: var(--panel-hover);
    transform: rotate(90deg);
  }

  .sections {
    padding: 4px 0;
  }

  .section {
    padding: 8px 16px;
  }

  .section-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    opacity: 0.6;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }

  .row-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0;
  }

  .label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-size: 12.5px;
    color: var(--text-secondary);
    font-weight: 450;
  }

  .desc {
    font-size: 10.5px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toggle {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-control-bg);
    cursor: pointer;
    position: relative;
    transition: all 0.3s var(--ease-out-expo);
    flex-shrink: 0;
    padding: 0;
  }

  .toggle.active {
    background: var(--panel-control-active);
    border-color: var(--panel-control-active-border);
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-tertiary);
    transition: all 0.3s var(--ease-spring);
  }

  .toggle.active .toggle-knob {
    left: 19px;
    background: var(--text);
  }

  .pill {
    padding: 3px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 450;
    color: var(--text-secondary);
    background: var(--panel-control-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .pill:hover {
    color: var(--text);
    background: var(--panel-hover);
    border-color: var(--border-focus);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .step-btn {
    width: 24px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-tertiary);
    background: var(--panel-control-bg);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .step-btn:hover {
    color: var(--text);
    background: var(--panel-hover);
  }

  .step-value {
    width: 28px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    border-left: 1px solid var(--border-subtle);
    border-right: 1px solid var(--border-subtle);
    line-height: 22px;
  }

  .mcp-empty {
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0.5;
    font-style: italic;
    padding: 4px 0;
  }

  .mcp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
  }

  .mcp-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mcp-name {
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .mcp-cmd {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mcp-remove {
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .mcp-row:hover .mcp-remove {
    opacity: 0.5;
  }

  .mcp-remove:hover {
    opacity: 1 !important;
    color: #f87171;
    background: rgba(248, 113, 113, 0.1);
  }

  .mcp-add-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 0;
  }

  .mcp-input {
    width: 100%;
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.2s ease;
  }

  .mcp-input:focus {
    border-color: var(--border-focus);
    color: var(--text);
  }

  .mcp-input::placeholder {
    color: var(--text-tertiary);
  }

  .mcp-add-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    padding-top: 2px;
  }

  .mcp-status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-tertiary);
    opacity: 0.3;
    transition: all 0.3s ease;
  }

  .mcp-status-dot.healthy {
    background: rgba(100, 220, 140, 0.9);
    opacity: 1;
    box-shadow: 0 0 4px rgba(100, 220, 140, 0.3);
  }

  .mcp-status-dot.unhealthy {
    background: rgba(255, 100, 100, 0.9);
    opacity: 1;
    box-shadow: 0 0 4px rgba(255, 100, 100, 0.3);
  }

  .mcp-status-dot.checking {
    animation: mcp-pulse 1s ease-in-out infinite;
    opacity: 0.6;
  }

  @keyframes mcp-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.8; }
  }

  .mcp-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    margin-left: 4px;
    opacity: 0.5;
    transition: all 0.2s ease;
    vertical-align: middle;
  }

  .mcp-refresh:hover {
    opacity: 1;
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.05);
  }

  .hook-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 0;
  }

  .hook-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hook-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hook-event {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-secondary);
    padding: 1px 5px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }

  .hook-matcher {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.7;
  }

  .hook-cmd {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hook-select {
    width: 100%;
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s ease;
  }

  .hook-select option {
    background: #1a1a2e;
    color: var(--text-secondary);
    padding: 4px 8px;
  }

  .hook-select:focus {
    border-color: var(--border-focus);
    color: var(--text);
  }

  :global([data-theme="light"]) .hook-select option {
    background: #f8f8fa;
    color: #333;
  }

  .sys-prompt {
    width: 100%;
    min-height: 48px;
    max-height: 120px;
    resize: none;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.2s ease;
  }
  .sys-prompt:focus {
    border-color: var(--border-focus);
    color: var(--text);
  }
  .help-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    font-size: 9px;
    font-weight: 600;
    font-style: normal;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-subtle);
    cursor: help;
    margin-left: 6px;
    vertical-align: middle;
    transition: all 0.15s ease;
    line-height: 1;
  }

  .help-trigger:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--border);
  }

  .help-tooltip {
    position: fixed;
    z-index: 200;
    max-width: min(560px, calc(100vw - 32px));
    padding: 10px 14px;
    background: rgba(20, 20, 35, 0.96);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    animation: helpIn 0.15s var(--ease-out-expo);
    pointer-events: none;
  }

  @keyframes helpIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .help-text {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 240px;
    overflow-y: auto;
  }

  :global([data-theme="light"]) .help-tooltip {
    background: rgba(250, 250, 252, 0.96);
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  }

  :global([data-theme="light"]) .help-trigger {
    background: rgba(0, 0, 0, 0.04);
  }

  :global([data-theme="light"]) .help-trigger:hover {
    background: rgba(0, 0, 0, 0.08);
  }

  .cli-status {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .cli-ok {
    color: rgba(100, 220, 140, 0.9);
    display: flex;
  }

  .cli-err {
    color: rgba(255, 100, 100, 0.9);
    display: flex;
  }

  .cli-checking {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--text-tertiary);
    border-top-color: transparent;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .cli-path-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .cli-path-row .mcp-input {
    flex: 1;
  }

  .sys-prompt::placeholder {
    color: var(--text-tertiary);
  }
</style>
