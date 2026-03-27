<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";

  const appWindow = getCurrentWindow();
  import ChatView from "./lib/components/ChatView.svelte";
  import InputBar from "./lib/components/InputBar.svelte";
  import TabBar from "./lib/components/TabBar.svelte";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import AgentPanel from "./lib/components/AgentPanel.svelte";
  import SessionManager from "./lib/components/SessionManager.svelte";
  import TodoPanel from "./lib/components/TodoPanel.svelte";
  import ContextIndicator from "./lib/components/ContextIndicator.svelte";
  import FileTree from "./lib/components/FileTree.svelte";
  import ChangeTracker from "./lib/components/ChangeTracker.svelte";
  import FileEditor from "./lib/components/FileEditor.svelte";
  import ShortcutHelp from "./lib/components/ShortcutHelp.svelte";
  import SearchOverlay from "./lib/components/SearchOverlay.svelte";
  import type { ChatMessage, ClaudeEvent, Tab, SlashCommand, ToolCall, SessionRecord, TokenUsage, PermissionMode, TodoItem, AgentInfo } from "./lib/types";
  import { BUILTIN_COMMANDS, MAX_SESSION_HISTORY, emptyUsage, addUsage, formatTokens, calculateCost, formatCost, PERMISSION_TOOL_SETS, extractTodos, extractFileStats, extractFileChanges, MODEL_CONTEXT_LIMITS } from "./lib/types";
  import { processClaudeEvent, cleanupTabState } from "./lib/claude";

  let settingsOpen = $state(false);
  let agentPanelOpen = $state(false);
  let sessionManagerOpen = $state(false);
  let fileTreeOpen = $state(false);
  let shortcutHelpOpen = $state(false);
  let sysPromptOpen = $state(false);
  let searchOpen = $state(false);
  let changeTrackerOpen = $state(false);
  let fileEditorOpen = $state(false);
  let fileEditorPath = $state("");

  /** Steering is always available — prompts go via stdin stream-json */
  const canSteer = true;

  /** Active permission request waiting for user decision */
  let permissionRequest = $state<{
    tabId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    description?: string;
  } | null>(null);
  let allCommands = $state<SlashCommand[]>(BUILTIN_COMMANDS);
  let agentList = $state<AgentInfo[]>([]);
  let autoScrollEnabled = $state(
    localStorage.getItem("clauke:autoScroll") !== "false",
  );

  function handleSettingsChange(settings: Record<string, string>) {
    autoScrollEnabled = settings.autoScroll !== "false";
  }

  /** Load custom slash commands from ~/.claude/commands/, plugins, etc. */
  async function loadSlashCommands(cwd?: string) {
    try {
      const discovered: Array<{
        name: string;
        description: string;
        kind: string;
        source: string;
      }> = await invoke("list_slash_commands", { cwd: cwd || null });

      // Merge: built-in first, then custom (skip duplicates)
      const seen = new Set(BUILTIN_COMMANDS.map((c) => c.name));
      const custom: SlashCommand[] = discovered
        .filter((c) => !seen.has(c.name))
        .map((c) => ({
          name: c.name,
          description: c.description,
          kind: c.kind as SlashCommand["kind"],
          source: c.source,
        }));
      allCommands = [...BUILTIN_COMMANDS, ...custom];
    } catch {
      // Silently fall back to built-in commands
      allCommands = BUILTIN_COMMANDS;
    }
  }
  let tabCounter = 0;

  function createTab(): Tab {
    tabCounter++;
    return {
      id: `tab-${tabCounter}-${Date.now()}`,
      name: "new tab",
      messages: [],
      isRunning: false,
      cwd: localStorage.getItem("clauke:defaultCwd") || "",
      model: (localStorage.getItem("clauke:defaultModel") as import("./lib/types").ClaudeModel) || "opus",
      effort: (localStorage.getItem("clauke:defaultEffort") as import("./lib/types").EffortLevel) || "max",
      permissionMode: (localStorage.getItem("clauke:permissionMode") as PermissionMode) || "bypass",
      systemPrompt: localStorage.getItem("clauke:systemPrompt") || "",
    };
  }

  /** Parse raw session JSON into tabs. Throws on invalid data. */
  function parseSessionData(raw: string): { tabs: Tab[]; activeId: string } {
    const data = JSON.parse(raw);
      if (!Array.isArray(data.tabs) || data.tabs.length === 0) throw new Error("empty");
      const restored: Tab[] = data.tabs.map((t: any) => {
        // Bump counter so new tabs get higher numbers
        const num = parseInt(t.id?.split("-")[1] || "0", 10);
        if (num > tabCounter) tabCounter = num;
        return {
          id: t.id,
          name: t.name || "tab",
          messages: Array.isArray(t.messages) ? t.messages : [],
          isRunning: false,
          cwd: t.cwd || "",
          model: t.model || "opus",
          effort: t.effort || "max",
          sessionId: t.sessionId,
          permissionMode: t.permissionMode || "bypass",
          contextTokens: t.contextTokens || undefined,
          systemPrompt: t.systemPrompt || "",
          addDirs: Array.isArray(t.addDirs) ? t.addDirs : undefined,
          agent: t.agent || undefined,
        } as Tab;
      });
    const activeId = data.activeTabId && restored.some((t: Tab) => t.id === data.activeTabId)
      ? data.activeTabId
      : restored[0].id;
    return { tabs: restored, activeId };
  }

  /** Restore tabs from filesystem or localStorage, or create a fresh tab */
  function restoreTabs(): { tabs: Tab[]; activeId: string } {
    // Synchronous restore from localStorage (filesystem restore happens async in onMount)
    try {
      const raw = localStorage.getItem("clauke:session");
      if (!raw) throw new Error("no session");
      return parseSessionData(raw);
    } catch {
      const first = createTab();
      return { tabs: [first], activeId: first.id };
    }
  }

  /** Truncate messages for storage */
  function truncateForStorage(messages: ChatMessage[]) {
    return messages.map((m) => ({
      ...m,
      content: m.content.map((b) => {
        if (b.type === "tool_call" && b.toolCall.result && b.toolCall.result.length > 800) {
          return { ...b, toolCall: { ...b.toolCall, result: b.toolCall.result.slice(0, 800) + "\n…(truncated)" } };
        }
        if (b.type === "thinking" && b.text.length > 500) {
          return { ...b, text: b.text.slice(0, 500) + "\n…(truncated)" };
        }
        return b;
      }),
    }));
  }

  /** Save current tabs to filesystem (debounced via caller) */
  function persistSession() {
    const serializable = tabs.map((t) => ({
      id: t.id,
      name: t.name,
      cwd: t.cwd,
      model: t.model,
      effort: t.effort,
      permissionMode: t.permissionMode,
      sessionId: t.sessionId,
      contextTokens: t.contextTokens,
      systemPrompt: t.systemPrompt,
      addDirs: t.addDirs,
      agent: t.agent,
      messages: truncateForStorage(t.messages),
    }));
    const data = JSON.stringify({ tabs: serializable, activeTabId });
    // Always keep localStorage in sync (sync restore reads it on next launch)
    try { localStorage.setItem("clauke:session", data); } catch { /* quota exceeded */ }
    invoke("storage_write", { key: "session", value: data }).catch(() => {});
  }

  // ── Session History (archived sessions) ──

  function loadSessionHistory(): SessionRecord[] {
    // Synchronous load from localStorage; async filesystem load in onMount
    try {
      const raw = localStorage.getItem("clauke:sessionHistory");
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /** Async load from filesystem — called in onMount */
  async function loadSessionHistoryFromFs() {
    try {
      const raw = await invoke<string | null>("storage_read", { key: "sessionHistory" });
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          sessionHistory = data;
        }
      } else if (sessionHistory.length > 0) {
        // Migrate localStorage history to filesystem
        saveSessionHistory();
      }
    } catch { /* keep localStorage data */ }
  }

  function saveSessionHistory() {
    const data = JSON.stringify(sessionHistory);
    invoke("storage_write", { key: "sessionHistory", value: data }).catch(() => {
      try { localStorage.setItem("clauke:sessionHistory", data); } catch { /* quota exceeded */ }
    });
  }

  /** Archive a tab to session history (only if it has a sessionId and messages) */
  function archiveTab(tab: Tab) {
    if (!tab.sessionId || tab.messages.length === 0) return;

    // Don't duplicate — update if already archived
    const existingIdx = sessionHistory.findIndex((s) => s.sessionId === tab.sessionId);

    const firstUserMsg = tab.messages.find((m) => m.role === "user");
    const preview = firstUserMsg
      ? firstUserMsg.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join(" ")
          .slice(0, 120)
      : "";

    const storedMessages = truncateForStorage(tab.messages);

    const record: SessionRecord = {
      id: existingIdx >= 0 ? sessionHistory[existingIdx].id : `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: tab.sessionId,
      name: tab.name,
      cwd: tab.cwd,
      model: tab.model,
      effort: tab.effort,
      createdAt: existingIdx >= 0 ? sessionHistory[existingIdx].createdAt : (tab.messages[0]?.timestamp || Date.now()),
      lastActiveAt: Date.now(),
      messageCount: tab.messages.length,
      preview,
      messages: storedMessages,
    };

    if (existingIdx >= 0) {
      sessionHistory[existingIdx] = record;
    } else {
      sessionHistory.unshift(record);
    }

    // Cap history
    if (sessionHistory.length > MAX_SESSION_HISTORY) {
      sessionHistory = sessionHistory.slice(0, MAX_SESSION_HISTORY);
    }

    saveSessionHistory();
  }

  function deleteArchivedSession(id: string) {
    sessionHistory = sessionHistory.filter((s) => s.id !== id);
    saveSessionHistory();
  }

  function restoreSession(session: SessionRecord) {
    tabCounter++;
    const newTab: Tab = {
      id: `tab-${tabCounter}-${Date.now()}`,
      name: session.name,
      messages: session.messages,
      isRunning: false,
      cwd: session.cwd,
      model: session.model,
      effort: session.effort,
      sessionId: session.sessionId,
      permissionMode: (localStorage.getItem("clauke:permissionMode") as PermissionMode) || "bypass",
    };
    tabs.push(newTab);
    activeTabId = newTab.id;
    sessionManagerOpen = false;
  }

  let sessionHistory = $state<SessionRecord[]>(loadSessionHistory());

  const initial = restoreTabs();
  let tabs = $state<Tab[]>(initial.tabs);
  let activeTabId = $state(initial.activeId);

  let activeTab = $derived(tabs.find((t) => t.id === activeTabId)!);

  /** Extract todos from active tab's messages */
  let activeTodos = $derived(extractTodos(activeTab?.messages ?? []));

  /** Extract file stats for diff overlay on the file explorer */
  let activeFileStats = $derived(extractFileStats(activeTab?.messages ?? []));

  /** Extract file changes for the change tracker */
  let activeFileChanges = $derived(extractFileChanges(activeTab?.messages ?? []));

  /** Extract all Agent tool calls from the active tab's messages (newest first) */
  let activeAgents = $derived.by(() => {
    const msgs = activeTab?.messages ?? [];
    const agents: ToolCall[] = [];
    for (const msg of msgs) {
      if (msg.role !== "assistant") continue;
      for (const block of msg.content) {
        if (block.type === "tool_call" && block.toolCall.name === "Agent") {
          agents.push(block.toolCall);
        }
      }
    }
    return agents.reverse();
  });

  function findTab(tabId: string): Tab | undefined {
    return tabs.find((t) => t.id === tabId);
  }

  // Auto-save session whenever tabs change (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Read reactive state to track changes
    const _track = JSON.stringify(tabs.map(t => ({ id: t.id, name: t.name, msgCount: t.messages.length, sessionId: t.sessionId })));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistSession, 500);
    return () => clearTimeout(saveTimer);
  });

  // ── Discord RPC: update presence on state transitions ──
  let lastRpcActivity = "";
  $effect(() => {
    const tab = activeTab;
    if (!tab) return;

    // Determine current activity
    let activity = "idle";
    if (tab.isRunning) {
      activity = "thinking";
      // Check for active tool calls
      const msgs = tab.messages;
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        if (last.role === "assistant") {
          for (let i = last.content.length - 1; i >= 0; i--) {
            const block = last.content[i];
            if (block.type === "tool_call" && !block.toolCall.isComplete) {
              activity = `tool:${block.toolCall.name}`;
              break;
            }
          }
        }
      }
    }

    // Only update when activity or model changes
    const rpcKey = `${tab.model}:${activity}:${tab.messages.length}`;
    if (rpcKey === lastRpcActivity) return;
    lastRpcActivity = rpcKey;

    invoke("update_discord_rpc", {
      model: tab.model.charAt(0).toUpperCase() + tab.model.slice(1),
      activityStr: activity,
      messageCount: tab.messages.length,
    }).catch(() => {});
  });

  onMount(() => {
    // Disable browser context menu in production builds
    if (!import.meta.env.DEV) {
      document.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // Load custom commands and agents on startup
    loadSlashCommands(activeTab.cwd || undefined);
    invoke<AgentInfo[]>("list_agents").then((agents) => { agentList = agents; }).catch(() => {});

    // Auto-detect and set preferred editor if not yet configured — default to VS Code
    if (!localStorage.getItem("clauke:editor")) {
      localStorage.setItem("clauke:editor", "vscode");
    }

    // Safety net: persist session on app close so debounced saves aren't lost
    const handleBeforeUnload = () => persistSession();
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Try to restore from filesystem (async — upgrades from localStorage)
    invoke<string | null>("storage_read", { key: "session" }).then((raw) => {
      if (raw) {
        try {
          const restored = parseSessionData(raw);
          // Only apply if we haven't started any new work yet
          if (tabs.length === 1 && tabs[0].messages.length === 0) {
            tabs.splice(0, tabs.length, ...restored.tabs);
            activeTabId = restored.activeId;
          }
        } catch { /* keep current tabs */ }
      } else {
        // No filesystem data yet — persist current localStorage data to filesystem
        persistSession();
      }
    }).catch(() => {});

    // Load session history from filesystem
    loadSessionHistoryFromFs();

    const unlistenEvent = listen<ClaudeEvent>("claude-event", (e) => {
      const tabId = e.payload.tab_id;
      if (!tabId) return;
      const tab = findTab(tabId);
      if (!tab) return;
      // Handle session expired — clear stale sessionId before processing
      if ((e.payload as any).subtype === "session_expired") {
        tab.sessionId = undefined;
        return;
      }
      const result = processClaudeEvent(e.payload, tab.messages, tabId as string);
      // Capture session_id for conversation continuation
      if (result.sessionId) {
        tab.sessionId = result.sessionId;
      }
      // Accumulate token usage
      if (result.usage) {
        tab.usage = addUsage(tab.usage || emptyUsage(), result.usage);
      }
      // Track context window fill.
      // The CLI's result event reports cumulative usage across all API calls
      // in the agentic loop (e.g. 5 tool calls × 150k = 750k+), not the
      // current context window fill of a single call. Cap at the model's
      // actual context limit so the indicator stays meaningful.
      if (result.usage) {
        const maxCtx = MODEL_CONTEXT_LIMITS[tab.model] || 200_000;
        const ctx = Math.min(
          result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheCreationTokens,
          maxCtx,
        );
        if (ctx > 0) {
          tab.contextTokens = ctx;
        }
      }
      // Handle permission requests
      if (result.permissionRequest) {
        permissionRequest = {
          tabId: tabId as string,
          ...result.permissionRequest,
        };
      }
      // Turn complete — stop the loading animation.
      // The CLI process stays alive (for steering), but Claude is done generating.
      if (result.turnComplete) {
        tab.isRunning = false;
        persistSession();
      }
    });

    const unlistenDone = listen<string>("claude-done", (e) => {
      const tabId = e.payload;
      const tab = findTab(tabId);
      if (tab) {
        tab.isRunning = false;
      }
    });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Final save before teardown — the debounced $effect cleanup cancels pending saves
      persistSession();
      unlistenEvent.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  });

  async function handleSend(prompt: string, images: string[] = []) {
    const tab = activeTab;
    if ((!prompt.trim() && images.length === 0) || tab.isRunning) return;

    const content: import("./lib/types").ContentBlock[] = [];
    for (const img of images) {
      content.push({ type: "image", path: img });
    }
    if (prompt.trim()) {
      content.push({ type: "text", text: prompt });
    }

    tab.messages.push({
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    });
    tab.isRunning = true;
    tab.runStartTime = Date.now();

    // Name tab after first prompt — set a quick label, then auto-title in background
    if (tab.messages.filter((m) => m.role === "user").length === 1) {
      const label = prompt || `image${images.length > 1 ? "s" : ""}`;
      tab.name = label.length > 24 ? label.slice(0, 24) + "\u2026" : label;

      // Fire-and-forget: generate a better title with haiku
      if (prompt) {
        const tabId = tab.id;
        invoke<string>("generate_title", { prompt: prompt.slice(0, 200), claudePath: localStorage.getItem("clauke:claudePath") || null })
          .then((title) => {
            const t = findTab(tabId);
            if (t) {
              t.name = title;
            }
          })
          .catch(() => {}); // Silently keep the manual label
      }
    }

    try {
      const mode = tab.permissionMode;
      const skipPerms = mode === "bypass";
      let allowedTools: string[] | null = null;
      if (!skipPerms && mode in PERMISSION_TOOL_SETS) {
        allowedTools = PERMISSION_TOOL_SETS[mode];
      }
      // For plan mode: prepend a plan-first instruction to the system prompt
      let sysPrompt = tab.systemPrompt || "";
      if (mode === "plan") {
        const planPrefix = "You are in PLAN MODE. Before making any file changes, first analyze the codebase and create a detailed step-by-step plan. Present the plan clearly and wait for the user to approve it before proceeding with implementation. Only use read-only tools (Read, Glob, Grep, WebFetch, WebSearch) until the user explicitly approves your plan.";
        sysPrompt = sysPrompt ? `${planPrefix}\n\n${sysPrompt}` : planPrefix;
      }
      await invoke("send_prompt", {
        request: {
          prompt: prompt || "Describe the attached image(s).",
          cwd: tab.cwd || null,
          tab_id: tab.id,
          model: tab.model,
          effort: tab.effort,
          session_id: tab.sessionId || null,
          images: images.length > 0 ? images : null,
          skip_permissions: skipPerms,
          allowed_tools: allowedTools,
          system_prompt: sysPrompt || null,
          add_dirs: tab.addDirs?.length ? tab.addDirs : null,
          agent: tab.agent || null,
          claude_path: localStorage.getItem("clauke:claudePath") || null,
        },
      });
    } catch (err) {
      tab.isRunning = false;
      tab.messages.push({
        id: `err-${Date.now()}`,
        role: "assistant",
        content: [{ type: "text", text: `**Error:** ${err}` }],
        timestamp: Date.now(),
      });
    }
  }

  async function handleSteer(message: string) {
    const tab = activeTab;
    if (!tab.isRunning || !message.trim()) return;

    // Add as user message in chat
    tab.messages.push({
      id: `steer-${Date.now()}`,
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp: Date.now(),
    });

    try {
      await invoke("steer_claude", { tabId: tab.id, message });
      // Steering sent — Claude will start generating again
      tab.isRunning = true;
      tab.runStartTime = Date.now();
    } catch (err) {
      console.warn("Steering failed:", err);
    }
  }

  async function handleStop() {
    const tab = activeTab;
    try {
      await invoke("stop_claude", { tabId: tab.id });
    } catch {
      // ignore — claude-done event will reset isRunning
    }
  }

  function handleClear() {
    const tab = activeTab;
    if (!tab.isRunning) {
      tab.messages = [];
      tab.sessionId = undefined;
      tab.usage = undefined;
      tab.contextTokens = undefined;
      tabs = [...tabs];
      persistSession();
    }
  }

  async function handleContinue() {
    const tab = activeTab;
    if (tab.isRunning || tab.messages.length > 0 || tab.sessionId) return;

    // Add a system message so the user knows what's happening
    tab.messages.push({
      id: `sys-continue-${Date.now()}`,
      role: "system",
      content: [{ type: "text", text: "continuing last session..." }],
      timestamp: Date.now(),
    });
    tab.isRunning = true;
    tab.runStartTime = Date.now();

    try {
      const mode = tab.permissionMode;
      const skipPerms = mode === "bypass";
      let allowedTools: string[] | null = null;
      if (!skipPerms && mode in PERMISSION_TOOL_SETS) {
        allowedTools = PERMISSION_TOOL_SETS[mode];
      }
      await invoke("send_prompt", {
        request: {
          prompt: "Continue where you left off.",
          cwd: tab.cwd || null,
          tab_id: tab.id,
          model: tab.model,
          effort: tab.effort,
          session_id: null,
          images: null,
          skip_permissions: skipPerms,
          allowed_tools: allowedTools,
          system_prompt: tab.systemPrompt || null,
          add_dirs: tab.addDirs?.length ? tab.addDirs : null,
          agent: tab.agent || null,
          continue_last: true,
          claude_path: localStorage.getItem("clauke:claudePath") || null,
        },
      });
    } catch (err) {
      tab.isRunning = false;
      tab.messages.push({
        id: `err-${Date.now()}`,
        role: "assistant",
        content: [{ type: "text", text: `**Error:** ${err}` }],
        timestamp: Date.now(),
      });
    }
  }

  function handleCommand(cmd: SlashCommand) {
    if (cmd.kind === "local") {
      if (cmd.name === "/clear") handleClear();
    } else {
      // Both "cli" and "custom" commands are sent as prompts — Claude handles them
      handleSend(cmd.name);
    }
  }

  function handleNewTab() {
    const newTab = createTab();
    tabs.push(newTab);
    activeTabId = newTab.id;
  }

  function handleCloseTab(id: string) {
    const tab = findTab(id);
    if (tab?.isRunning) {
      invoke("stop_claude", { tabId: id }).catch(() => {});
    }
    // Archive the tab before closing
    if (tab) archiveTab(tab);
    // Clean up internal parser state for this tab
    cleanupTabState(id);
    const idx = tabs.findIndex((t) => t.id === id);
    if (tabs.length <= 1) return;
    tabs.splice(idx, 1);
    if (activeTabId === id) {
      activeTabId = tabs[Math.min(idx, tabs.length - 1)].id;
    }
    // Save immediately — don't rely on the debounced $effect which gets
    // cancelled on component destroy (app close), causing zombie tabs.
    persistSession();
  }

  function handleSelectTab(id: string) {
    activeTabId = id;
  }

  function handleCompact() {
    const tab = activeTab;
    if (tab.isRunning || !tab.sessionId) return;
    handleSend("/compact");
  }

  function handleRenameTab(id: string, name: string) {
    const tab = findTab(id);
    if (tab) {
      tab.name = name;
    }
  }

  async function browseFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const oldCwd = activeTab.cwd;
      activeTab.cwd = selected as string;
      // Session is tied to the old directory — clear it to avoid resume failures
      if (oldCwd !== activeTab.cwd) {
        activeTab.sessionId = undefined;
      }
      // Reload commands — project might have its own .claude/commands/
      loadSlashCommands(activeTab.cwd);
    }
  }

  async function addExtraDir() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const dir = selected as string;
      // Don't add CWD or duplicates
      if (dir === activeTab.cwd) return;
      if (activeTab.addDirs?.includes(dir)) return;
      activeTab.addDirs = [...(activeTab.addDirs || []), dir];
    }
  }

  function removeExtraDir(index: number) {
    if (!activeTab.addDirs) return;
    activeTab.addDirs = activeTab.addDirs.filter((_, i) => i !== index);
    if (activeTab.addDirs.length === 0) activeTab.addDirs = undefined;
  }

  function openInEditor(filePath: string) {
    fileEditorPath = filePath;
    fileEditorOpen = true;
  }

  // ── Keyboard shortcuts ──
  function handleGlobalKeydown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    switch (e.key) {
      case "t":
        e.preventDefault();
        handleNewTab();
        break;
      case "w":
        e.preventDefault();
        handleCloseTab(activeTabId);
        break;
      case "l":
        e.preventDefault();
        handleClear();
        break;
      case "b":
        e.preventDefault();
        fileTreeOpen = !fileTreeOpen;
        break;
      case "f":
        e.preventDefault();
        searchOpen = !searchOpen;
        break;
      case "j":
        e.preventDefault();
        changeTrackerOpen = !changeTrackerOpen;
        break;
      case "/":
        e.preventDefault();
        shortcutHelpOpen = !shortcutHelpOpen;
        break;
      case "1": case "2": case "3": case "4":
      case "5": case "6": case "7": case "8": case "9": {
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          activeTabId = tabs[idx].id;
        }
        break;
      }
    }
  }

  // ── Conversation forking ──
  function handleFork(messageId: string) {
    const tab = activeTab;
    const msgIdx = tab.messages.findIndex((m) => m.id === messageId);
    if (msgIdx < 0) return;

    // Deep-clone messages so mutations in the original tab don't affect the fork
    const forkedMessages = tab.messages.slice(0, msgIdx + 1).map((m) => ({
      ...m,
      content: m.content.map((block) => {
        if (block.type === "tool_call") {
          return {
            type: "tool_call" as const,
            toolCall: {
              ...block.toolCall,
              input: { ...block.toolCall.input },
              children: block.toolCall.children?.map((c) => ({ ...c, input: { ...c.input } })),
            },
          };
        }
        return { ...block };
      }),
    }));

    tabCounter++;
    const newTab: Tab = {
      id: `tab-${tabCounter}-${Date.now()}`,
      name: `${tab.name} (fork)`,
      messages: forkedMessages,
      isRunning: false,
      cwd: tab.cwd,
      model: tab.model,
      effort: tab.effort,
      permissionMode: tab.permissionMode,
      systemPrompt: tab.systemPrompt,
      // No sessionId — this is a fresh fork, can't resume the old session
    };
    tabs.push(newTab);
    activeTabId = newTab.id;
  }

  // ── Permission handling ──
  async function handlePermissionResponse(allow: boolean) {
    if (!permissionRequest) return;
    const { tabId } = permissionRequest;
    permissionRequest = null;
    try {
      await invoke("steer_claude", { tabId, message: allow ? "y" : "n" });
    } catch (err) {
      console.warn("Permission response failed:", err);
    }
  }

  // ── Search navigation ──
  function handleSearchNavigate(messageId: string) {
    // Scroll the message into view
    const el = document.getElementById(messageId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Brief highlight flash
      el.classList.add("search-highlight");
      setTimeout(() => el.classList.remove("search-highlight"), 1500);
    }
  }

  // ── Edit & resend a user message ──
  let pendingEdit = $state<{ text: string; messageId: string } | null>(null);

  function handleEditMessage(messageId: string) {
    const tab = activeTab;
    if (tab.isRunning) return;
    const msgIdx = tab.messages.findIndex((m) => m.id === messageId);
    if (msgIdx < 0) return;
    const msg = tab.messages[msgIdx];
    if (msg.role !== "user") return;

    // Extract text from the message
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");

    // Truncate messages: keep everything up to (not including) this message
    tab.messages.splice(msgIdx);
    // Clear session so we don't resume with orphaned context
    tab.sessionId = undefined;
    // Set the text for the InputBar to pick up
    pendingEdit = { text, messageId };
  }

  // ── Copy full assistant message ──
  function handleCopyMessage(messageId: string) {
    const tab = activeTab;
    const msg = tab.messages.find((m) => m.id === messageId);
    if (!msg) return;
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="app">
  <header class="titlebar" data-tauri-drag-region>
    <span class="logo">clauke</span>
    <div class="titlebar-center">
      <div class="cwd-wrap">
        <input
          class="cwd-input"
          type="text"
          placeholder="working directory"
          bind:value={activeTab.cwd}
          onchange={() => { activeTab.sessionId = undefined; }}
        />
        <button class="btn-browse" onclick={browseFolder} title="Browse folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button class="btn-add-dir" onclick={addExtraDir} title="Add extra directory">+</button>
      </div>
      {#if activeTab.addDirs?.length}
        <div class="extra-dirs">
          {#each activeTab.addDirs as dir, i}
            <span class="dir-chip" title={dir}>
              {dir.replace(/\\/g, "/").split("/").pop()}
              <button class="dir-chip-remove" onclick={() => removeExtraDir(i)}>&times;</button>
            </span>
          {/each}
        </div>
      {/if}
    </div>
    <button
      class="btn-history"
      onclick={() => (sessionManagerOpen = !sessionManagerOpen)}
      title="Session history"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    </button>
    <button
      class="btn-clear"
      onclick={handleClear}
      disabled={activeTab.isRunning}
    >
      Clear
    </button>
    {#if !activeTab.isRunning && activeTab.messages.length === 0 && !activeTab.sessionId}
      <button
        class="btn-continue"
        onclick={handleContinue}
        title="Continue most recent session in this directory"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        Continue
      </button>
    {/if}
    <button
      class="btn-settings"
      onclick={() => (settingsOpen = !settingsOpen)}
      title="Settings"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
    <div class="window-controls">
      <button class="wc-btn" onclick={() => appWindow.minimize()} title="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="wc-btn" onclick={() => appWindow.toggleMaximize()} title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="wc-btn wc-close" onclick={() => appWindow.close()} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
          <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>
  </header>

  <TabBar
    {tabs}
    {activeTabId}
    onSelect={handleSelectTab}
    onClose={handleCloseTab}
    onNew={handleNewTab}
    onRename={handleRenameTab}
  />

  <div class="main-row">
    <FileTree
      cwd={activeTab?.cwd || ""}
      open={fileTreeOpen}
      onToggle={() => (fileTreeOpen = !fileTreeOpen)}
      fileStats={activeFileStats}
      onOpenInEditor={openInEditor}
    />
    <main class="chat-area">
      <SearchOverlay
        messages={activeTab.messages}
        open={searchOpen}
        onClose={() => (searchOpen = false)}
        onNavigate={handleSearchNavigate}
      />
      {#key activeTabId}
        <ChatView messages={activeTab.messages} isRunning={activeTab.isRunning} runStartTime={activeTab.runStartTime} {autoScrollEnabled} onFork={handleFork} onCopy={handleCopyMessage} onEditMessage={handleEditMessage} />
      {/key}
    </main>
    <AgentPanel
      agents={activeAgents}
      open={agentPanelOpen}
      onToggle={() => (agentPanelOpen = !agentPanelOpen)}
    />
    <ChangeTracker
      changes={activeFileChanges}
      fileStats={activeFileStats}
      open={changeTrackerOpen}
      onToggle={() => (changeTrackerOpen = !changeTrackerOpen)}
      onOpenEditor={openInEditor}
    />
  </div>

  <footer class="input-area">
    <TodoPanel todos={activeTodos} />
    {#if sysPromptOpen}
      <div class="sys-prompt-bar">
        <textarea
          class="sys-prompt-input"
          placeholder="system prompt for this tab..."
          bind:value={activeTab.systemPrompt}
          rows="2"
        ></textarea>
        <button class="sys-prompt-close" onclick={() => (sysPromptOpen = false)} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>
    {/if}
    <InputBar
      onSend={handleSend}
      onSteer={handleSteer}
      onStop={handleStop}
      onCommand={handleCommand}
      isRunning={activeTab.isRunning}
      {canSteer}
      commands={allCommands}
      bind:model={activeTab.model}
      bind:effort={activeTab.effort}
      bind:permissionMode={activeTab.permissionMode}
      hasSystemPrompt={!!activeTab.systemPrompt}
      onToggleSystemPrompt={() => (sysPromptOpen = !sysPromptOpen)}
      prefill={pendingEdit?.text || ""}
      onPrefillConsumed={() => (pendingEdit = null)}
      bind:agent={activeTab.agent}
      agents={agentList}
    />
    <ContextIndicator
      tokens={activeTab.contextTokens || 0}
      model={activeTab.model}
      onCompact={handleCompact}
      canCompact={!!activeTab.sessionId && !activeTab.isRunning && (activeTab.contextTokens || 0) > 0}
    />
    <div class="token-bar">
      <span class="token-stat" title="Input tokens">
        <span class="token-label">in</span>
        <span class="token-value">{formatTokens(activeTab.usage?.inputTokens ?? 0)}</span>
      </span>
      <span class="token-stat" title="Output tokens">
        <span class="token-label">out</span>
        <span class="token-value">{formatTokens(activeTab.usage?.outputTokens ?? 0)}</span>
      </span>
      {#if (activeTab.usage?.cacheReadTokens ?? 0) > 0}
        <span class="token-stat" title="Cache read tokens">
          <span class="token-label">cache</span>
          <span class="token-value">{formatTokens(activeTab.usage?.cacheReadTokens ?? 0)}</span>
        </span>
      {/if}
      <span class="token-stat total" title="Total tokens">
        <span class="token-label">&Sigma;</span>
        <span class="token-value">{formatTokens((activeTab.usage?.inputTokens ?? 0) + (activeTab.usage?.outputTokens ?? 0))}</span>
      </span>
      <span class="token-stat cost" title="Estimated API cost for this session">
        <span class="token-value cost-value">{formatCost(calculateCost(activeTab.usage ?? emptyUsage(), activeTab.model))}</span>
      </span>
    </div>
  </footer>

  <!-- Permission dialog -->
  {#if permissionRequest && canSteer}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="perm-overlay" onkeydown={(e) => e.key === "Escape" && handlePermissionResponse(false)}>
      <div class="perm-dialog">
        <div class="perm-title">permission required</div>
        <div class="perm-tool">{permissionRequest.toolName}</div>
        {#if permissionRequest.description}
          <div class="perm-desc">{permissionRequest.description}</div>
        {/if}
        {#if Object.keys(permissionRequest.toolInput).length > 0}
          <pre class="perm-input">{JSON.stringify(permissionRequest.toolInput, null, 2)}</pre>
        {/if}
        <div class="perm-actions">
          <button class="perm-btn perm-deny" onclick={() => handlePermissionResponse(false)}>Deny</button>
          <button class="perm-btn perm-allow" onclick={() => handlePermissionResponse(true)}>Allow</button>
        </div>
      </div>
    </div>
  {/if}

  <FileEditor
    filePath={fileEditorPath}
    open={fileEditorOpen}
    onClose={() => (fileEditorOpen = false)}
  />
  <ShortcutHelp open={shortcutHelpOpen} onClose={() => (shortcutHelpOpen = false)} />
  <SettingsPanel open={settingsOpen} onClose={() => (settingsOpen = false)} onSettingsChange={handleSettingsChange} />
  <SessionManager
    open={sessionManagerOpen}
    sessions={sessionHistory}
    onClose={() => (sessionManagerOpen = false)}
    onRestore={restoreSession}
    onDelete={deleteArchivedSession}
  />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .titlebar {
    display: flex;
    align-items: center;
    padding: 10px 20px;
    gap: 16px;
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border-bottom: 1px solid var(--border-subtle);
    user-select: none;
    -webkit-app-region: drag;
  }

  .logo {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .titlebar-center {
    flex: 1;
    max-width: 400px;
    -webkit-app-region: no-drag;
  }

  .cwd-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .cwd-input {
    flex: 1;
    min-width: 0;
    padding: 5px 12px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: all 0.2s ease;
  }
  .cwd-input:focus {
    border-color: var(--border-focus);
    color: var(--text);
    background: var(--bg-input-focus);
  }
  .cwd-input::placeholder {
    color: var(--text-tertiary);
  }

  .btn-browse {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    background: var(--bg-input);
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .btn-browse:hover {
    color: var(--text-secondary);
    border-color: var(--border);
    background: var(--bg-glass-hover);
  }

  .btn-add-dir {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px dashed var(--border-subtle);
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 300;
    line-height: 1;
    transition: all 0.15s ease;
    opacity: 0.6;
  }
  .btn-add-dir:hover {
    color: var(--text-secondary);
    border-color: var(--border);
    background: var(--bg-input);
    opacity: 1;
  }

  .extra-dirs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .dir-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dir-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0;
    font-size: 11px;
    line-height: 1;
    border-radius: 3px;
    opacity: 0.5;
    transition: all 0.1s ease;
    flex-shrink: 0;
  }
  .dir-chip-remove:hover {
    opacity: 1;
    color: rgba(248, 113, 113, 0.9);
    background: rgba(239, 68, 68, 0.15);
  }

  .btn-history {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.2s ease;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }
  .btn-history:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
  }

  .btn-clear {
    padding: 4px 14px;
    font-size: 11.5px;
    font-weight: 450;
    color: var(--text-tertiary);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    -webkit-app-region: no-drag;
  }
  .btn-clear:hover:not(:disabled) {
    color: var(--text-secondary);
    border-color: var(--border);
    background: var(--bg-surface);
  }
  .btn-clear:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .btn-continue {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    font-size: 11.5px;
    font-weight: 450;
    color: rgba(167, 139, 250, 0.7);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    -webkit-app-region: no-drag;
    animation: fadeIn 0.3s var(--ease-out-expo);
  }
  .btn-continue:hover {
    color: rgba(167, 139, 250, 0.95);
    border-color: rgba(167, 139, 250, 0.2);
    background: rgba(167, 139, 250, 0.06);
  }

  .main-row {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .chat-area {
    flex: 1;
    overflow: hidden;
    min-width: 0;
  }

  .input-area {
    background: none;
  }

  .sys-prompt-bar {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    max-width: 860px;
    margin: 0 auto;
    padding: 0 20px 6px;
    animation: fadeIn 0.25s var(--ease-out-expo);
  }

  .sys-prompt-input {
    flex: 1;
    min-height: 32px;
    max-height: 80px;
    resize: none;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.2s ease;
  }
  .sys-prompt-input:focus {
    border-color: var(--border-focus);
    color: var(--text);
  }
  .sys-prompt-input::placeholder {
    color: var(--text-tertiary);
  }

  .sys-prompt-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-top: 5px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .sys-prompt-close:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
  }

  .token-bar {
    display: flex;
    justify-content: center;
    gap: 12px;
    padding: 2px 16px 6px;
    font-family: var(--font-mono);
    animation: fadeIn 0.3s var(--ease-out-expo);
  }

  .token-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
  }

  .token-label {
    color: var(--text-tertiary);
    opacity: 0.6;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .token-value {
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .token-stat.total .token-value {
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .token-stat.cost {
    margin-left: 4px;
    padding-left: 8px;
    border-left: 1px solid var(--border-subtle);
  }

  .cost-value {
    color: rgba(167, 139, 250, 0.75);
    font-weight: 500;
  }

  .btn-settings {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.25s var(--ease-out-expo);
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }
  .btn-settings:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
    transform: rotate(45deg);
  }

  .window-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .wc-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 24px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s var(--ease-out-quart);
  }
  .wc-btn:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
  }
  .wc-close:hover {
    color: #fff;
    background: rgba(220, 60, 60, 0.8);
  }

  /* ── Permission dialog ── */
  .perm-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    animation: overlayIn 0.2s var(--ease-out-expo);
  }

  @keyframes overlayIn {
    from { background: rgba(0, 0, 0, 0); }
    to { background: rgba(0, 0, 0, 0.4); }
  }

  .perm-dialog {
    width: 380px;
    max-width: 90vw;
    background: var(--glass-panel-bg);
    backdrop-filter: var(--glass-panel-blur);
    -webkit-backdrop-filter: var(--glass-panel-blur);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-md);
    padding: 20px;
    box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5);
    animation: scaleIn 0.25s var(--ease-out-expo);
  }

  .perm-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(251, 191, 36, 0.7);
    margin-bottom: 12px;
  }

  .perm-tool {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 8px;
  }

  .perm-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 8px;
    line-height: 1.5;
  }

  .perm-input {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--text-secondary);
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 8px 10px;
    max-height: 150px;
    overflow: auto;
    margin-bottom: 16px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .perm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .perm-btn {
    padding: 6px 18px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .perm-deny {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
  }
  .perm-deny:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.08);
  }

  .perm-allow {
    color: rgba(130, 220, 160, 0.9);
    background: rgba(130, 220, 160, 0.08);
    border-color: rgba(130, 220, 160, 0.2);
  }
  .perm-allow:hover {
    background: rgba(130, 220, 160, 0.15);
    border-color: rgba(130, 220, 160, 0.3);
  }
</style>
