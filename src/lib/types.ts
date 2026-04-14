/** Types for Claude stream-json events and UI state (clauke v0.3) */

export type ToolName =
  | "Read"
  | "Write"
  | "Edit"
  | "Bash"
  | "Glob"
  | "Grep"
  | "Agent"
  | "WebFetch"
  | "WebSearch"
  | string;

export interface ToolCall {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
  result?: string;
  isComplete: boolean;
  isError?: boolean;
  startTime: number;
  endTime?: number;
  /** True when completion was inferred (no explicit tool_result received) */
  inferredComplete?: boolean;
  /** For Agent tool calls: nested tool calls made by the sub-agent */
  children?: ToolCall[];
  /** Elapsed seconds from tool_progress events (real-time execution timer) */
  elapsedSeconds?: number;
}

// new event types from claude code stream-json

/** Background task tracked via task_started/progress/notification events */
export interface BackgroundTask {
  id: string;
  description: string;
  status: "running" | "completed" | "failed" | "stopped";
  toolUseId?: string;
  usage?: { totalTokens: number; toolUses: number; durationMs: number };
  summary?: string;
  lastToolName?: string;
  outputFile?: string;
}

/** Hook execution tracked via hook_started/progress/response events */
export interface HookExecution {
  id: string;
  name: string;
  event: string;
  status: "running" | "success" | "error" | "cancelled";
  output: string;
  exitCode?: number;
}

/** Rate limit info from rate_limit_event */
export interface RateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected";
  utilization: number;
  resetsAt: number;
  rateLimitType: string;
}

/** API retry info from system.api_retry */
export interface ApiRetryInfo {
  attempt: number;
  maxRetries: number;
  retryDelayMs: number;
  errorStatus?: number;
  error?: string;
}

/** Session state from session_state_changed */
export type SessionState = "idle" | "running" | "requires_action";

/** Compact boundary metadata */
export interface CompactBoundary {
  trigger: "manual" | "auto";
  preTokens: number;
}

/** Aggregated error info for display in chat */
export interface ErrorInfo {
  source: 'tool_result' | 'agent_failure' | 'permission_denied' | 'hook_error' | 'api_error' | 'rate_limit';
  message: string;
  toolName?: string;
  toolUseId?: string;
  agentId?: string;
  timestamp: number;
}

/** A content block — text, image, thinking, tool call, system divider, or unknown event */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; path: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "hook_result"; hookName: string; hookEvent: string; message: string; isBlock: boolean; isError: boolean }
  | { type: "divider"; text: string }
  | { type: "unknown_event"; eventType: string; preview: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
  timestamp: number;
}

export type AgentKind = "claude" | "codex" | "kimi";

export const DEFAULT_AGENT_KIND: AgentKind = "claude";

export interface AgentEvent {
  type: string;
  tab_id?: string;
  agent_kind?: AgentKind;
  [key: string]: unknown;
}

export type ClaudeEvent = AgentEvent;

export type ClaudeModel = "sonnet" | "opus" | "haiku";
export type CodexModel =
  | "gpt-5.4" | "gpt-5.4-mini"
  | "gpt-5.3-codex" | "gpt-5.3-codex-spark"
  | "gpt-5.2-codex" | "gpt-5.2"
  | "gpt-5.1-codex-max" | "gpt-5.1-codex-mini";
export type KimiThinkingMode = "default" | "thinking" | "no-thinking";
export type AgentModel = ClaudeModel | CodexModel | string;
export type EffortLevel = "low" | "medium" | "high" | "max";
export type CodexEffortLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentEffort = EffortLevel | CodexEffortLevel | KimiThinkingMode;
export type PermissionMode = "bypass" | "acceptEdits" | "plan" | "default" | "auto" | "dontAsk";
export type CodexApprovalMode = "never" | "on-failure" | "on-request" | "untrusted";
export type KimiPermissionMode = "default" | "plan" | "never";

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  bypass: "Bypass",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  default: "Ask",
  auto: "Auto",
  dontAsk: "Don't Ask",
};

export const CODEX_APPROVAL_LABELS: Record<CodexApprovalMode, string> = {
  never: "Full Auto",
  "on-failure": "On Failure",
  "on-request": "On Request",
  untrusted: "Ask All",
};

export const KIMI_PERMISSION_LABELS: Record<KimiPermissionMode, string> = {
  default: "Ask",
  plan: "Plan",
  never: "Full Auto",
};

/** Tools allowed per permission mode (bypass allows everything via CLI flag) */
export const PERMISSION_TOOL_SETS: Record<string, string[]> = {
  acceptEdits: ["Read", "Write", "Edit", "Glob", "Grep", "Agent", "WebFetch", "WebSearch", "TodoWrite", "NotebookEdit", "Skill"],
  plan: ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "TodoWrite"],
  default: [],
};

/** All known Claude Code tools that can be individually allowed/denied */
export const ALL_TOOLS = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep",
  "Agent", "WebFetch", "WebSearch", "TodoWrite",
  "NotebookEdit", "Skill",
] as const;
export type KnownTool = typeof ALL_TOOLS[number];

export const MODEL_LABELS: Record<ClaudeModel, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
};

export const CODEX_MODEL_LABELS: Record<CodexModel, string> = {
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2-codex": "GPT-5.2 Codex",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
  "gpt-5.1-codex-mini": "GPT-5.1 Codex Mini",
};

/** Get display label for any model regardless of provider */
export function getModelLabel(model: string): string {
  if (model in MODEL_LABELS) return MODEL_LABELS[model as ClaudeModel];
  if (model in CODEX_MODEL_LABELS) return CODEX_MODEL_LABELS[model as CodexModel];
  return model;
}

/** Describes what each agent provider's UI supports */
export interface AgentCapabilities {
  models: string[];
  modelLabels: Record<string, string>;
  defaultModel: string;
  hasEffort: boolean;
  effortLevels: string[];
  effortLabels: Record<string, string>;
  hasSubAgents: boolean;
  hasCostTracking: boolean;
  hasContextTracking: boolean;
  hasMcp: boolean;
  hasHooks: boolean;
  hasPermissionModes: boolean;
  /** Available permission/approval mode values for this provider */
  permissionModes?: string[];
  /** Display labels for permission/approval modes */
  permissionLabels?: Record<string, string>;
  hasSteering: boolean;
  hasSessionResume: boolean;
}

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

export const CODEX_EFFORT_LABELS: Record<CodexEffortLevel, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

export const KIMI_EFFORT_LABELS: Record<KimiThinkingMode, string> = {
  default: "Config",
  thinking: "Thinking",
  "no-thinking": "No Think",
};

export const AGENT_CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
  claude: {
    models: ["opus", "sonnet", "haiku"],
    modelLabels: MODEL_LABELS,
    defaultModel: "opus",
    hasEffort: true,
    effortLevels: ["low", "medium", "high", "max"],
    effortLabels: EFFORT_LABELS,
    hasSubAgents: true,
    hasCostTracking: true,
    hasContextTracking: true,
    hasMcp: true,
    hasHooks: true,
    hasPermissionModes: true,
    permissionModes: ["bypass", "acceptEdits", "plan", "default"],
    permissionLabels: PERMISSION_LABELS,
    hasSteering: true,
    hasSessionResume: true,
  },
  codex: {
    // Visible models ordered by priority (matches Codex CLI picker)
    models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2-codex", "gpt-5.2", "gpt-5.1-codex-max", "gpt-5.1-codex-mini"],
    modelLabels: CODEX_MODEL_LABELS,
    defaultModel: "gpt-5.4",
    hasEffort: true,
    effortLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
    effortLabels: CODEX_EFFORT_LABELS,
    // Codex has Collab Tools (SpawnAgent/SendInput/Wait/CloseAgent) but needs separate UI — disabled v1
    hasSubAgents: false,
    hasCostTracking: true,
    hasContextTracking: true,
    // Codex supports MCP but config is separate from Claude's ~/.claude/settings.json
    hasMcp: false,
    hasHooks: false,
    hasPermissionModes: true,
    permissionModes: ["never", "on-failure", "on-request", "untrusted"],
    permissionLabels: CODEX_APPROVAL_LABELS,
    // Codex supports turn/steer for follow-up messages mid-turn
    hasSteering: true,
    // Codex supports `codex resume` / `codex exec resume`
    hasSessionResume: true,
  },
  kimi: {
    models: ["kimi-code/kimi-for-coding"],
    modelLabels: {
      "kimi-code/kimi-for-coding": "Kimi for Coding",
    },
    defaultModel: "kimi-code/kimi-for-coding",
    hasEffort: true,
    effortLevels: ["default", "thinking", "no-thinking"],
    effortLabels: KIMI_EFFORT_LABELS,
    hasSubAgents: false,
    hasCostTracking: false,
    hasContextTracking: true,
    hasMcp: false,
    hasHooks: false,
    hasPermissionModes: true,
    permissionModes: ["default", "plan", "never"],
    permissionLabels: KIMI_PERMISSION_LABELS,
    hasSteering: true,
    hasSessionResume: true,
  },
};

/** Context window limits per model (in tokens) */
export const MODEL_CONTEXT_LIMITS: Record<ClaudeModel, number> = {
  opus: 1_000_000,
  sonnet: 200_000,
  haiku: 200_000,
};

/** Token usage stats for a single response or accumulated session */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Create a zeroed-out TokenUsage object */
export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

/** Format token count for display (e.g., 1234 → "1.2k", 123456 → "123k") */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

/** API pricing per million tokens (as of 2026) */
export const COST_PER_MILLION: Record<ClaudeModel, {
  input: number; output: number; cacheRead: number; cacheWrite: number;
}> = {
  sonnet: { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  opus:   { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  haiku:  { input: 0.80, output: 4, cacheRead: 0.08, cacheWrite: 1.00 },
};

/** Estimate dollar cost from token usage */
export function calculateCost(usage: TokenUsage, model: string): number {
  const r = COST_PER_MILLION[model as ClaudeModel];
  if (!r) return 0;
  return (
    usage.inputTokens * r.input +
    usage.outputTokens * r.output +
    usage.cacheReadTokens * r.cacheRead +
    usage.cacheCreationTokens * r.cacheWrite
  ) / 1_000_000;
}

/** Format dollar cost for display */
export function formatCost(dollars: number): string {
  if (dollars < 0.005) return "<$0.01";
  if (dollars < 10) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(1)}`;
}

export interface Tab {
  id: string;
  name: string;
  messages: ChatMessage[];
  isRunning: boolean;
  agentKind: AgentKind;
  cwd: string;
  model: AgentModel;
  effort: AgentEffort;
  sessionId?: string;
  usage?: TokenUsage;
  /** Last input token count — approximates current context window fill level */
  contextTokens?: number;
  /** Authoritative session cost from CLI (accumulated total_cost_usd) */
  totalCostUsd?: number;
  permissionMode: string;
  /** Per-tab system prompt (overrides global default when set) */
  systemPrompt?: string;
  /** Additional directories Claude can access beyond CWD */
  addDirs?: string[];
  /** Selected agent name (from `claude agents`) */
  agent?: string;
  /** Timestamp when the current run started (for elapsed timer) */
  runStartTime?: number;
  /** Internal: intermediate usage accumulated during current turn (reset on turnComplete) */
  _turnUsage?: TokenUsage;

  // Phase 1: New state from Claude Code stream-json events
  /** Background tasks spawned by Agent/Task tools */
  backgroundTasks?: Map<string, BackgroundTask>;
  /** Currently executing hooks */
  activeHooks?: Map<string, HookExecution>;
  /** Rate limit status from last rate_limit_event */
  rateLimit?: RateLimitInfo;
  /** API retry in progress */
  apiRetry?: ApiRetryInfo;
  /** Authoritative session lifecycle state */
  sessionState?: SessionState;
  /** Prompt suggestions from CLI */
  suggestions?: string[];
}

/** Agent entry from `claude agents` output */
export interface AgentInfo {
  name: string;
  model: string;
  source: string;
}

/** A single task from Claude's TodoWrite tool */
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

/** Extract the latest todo list from messages (last TodoWrite call wins) */
export function extractTodos(messages: ChatMessage[]): TodoItem[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j];
      if (block.type === "tool_call" && block.toolCall.name === "TodoWrite") {
        const input = block.toolCall.input;
        if (Array.isArray(input.todos)) {
          return input.todos as TodoItem[];
        }
      }
    }
  }
  return [];
}

/** Hook event types supported by Claude Code CLI */
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "Stop",
] as const;
export type HookEvent = typeof HOOK_EVENTS[number];

export const HOOK_EVENT_LABELS: Record<HookEvent, string> = {
  PreToolUse: "Before tool use",
  PostToolUse: "After tool use",
  SessionStart: "Session start",
  SessionEnd: "Session end",
  Stop: "On stop",
};

/** A single hook action */
export interface HookAction {
  type: "command";
  command: string;
}

/** A hook rule: matcher + list of actions */
export interface HookRule {
  matcher: string;
  hooks: HookAction[];
}

/** Full hook configuration (event → rules) */
export type HookConfig = Record<string, HookRule[]>;

/** MCP server transport type */
export type McpServerType = "stdio" | "http" | "sse";

/** MCP server configuration */
export interface McpServer {
  name: string;
  type: McpServerType;
  /** stdio fields */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http/sse fields */
  url?: string;
}

/** Archived session record for the session manager */
export interface SessionRecord {
  /** Unique archive ID */
  id: string;
  /** Claude CLI session ID (for --resume) */
  sessionId: string;
  /** Tab name / conversation title */
  name: string;
  agentKind: AgentKind;
  /** Working directory */
  cwd: string;
  model: AgentModel;
  effort: AgentEffort;
  permissionMode?: string;
  systemPrompt?: string;
  addDirs?: string[];
  agent?: string;
  /** When the session was first created */
  createdAt: number;
  /** When the session was last active */
  lastActiveAt: number;
  /** Total message count */
  messageCount: number;
  /** Preview text (first user message) */
  preview: string;
  /** Stored messages (tool results truncated) */
  messages: ChatMessage[];
}

/** Max number of archived sessions to keep */
export const MAX_SESSION_HISTORY = 50;

/** Slash command definition */
export interface SlashCommand {
  name: string;
  description: string;
  /** "local" commands are handled by clauke, "cli" are sent as prompts, "custom" are user/plugin skills */
  kind: "local" | "cli" | "custom";
  /** Where this command comes from */
  source?: string;
}

/** Built-in commands that are always available (handled locally or by the CLI) */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "/add-dir", description: "Add working directory to session", kind: "cli" },
  { name: "/agents", description: "Manage agent configurations", kind: "cli" },
  { name: "/branch", description: "Branch the current conversation", kind: "cli" },
  { name: "/bug", description: "Submit feedback", kind: "cli" },
  { name: "/chrome", description: "Configure Chrome integration", kind: "cli" },
  { name: "/clear", description: "Clear conversation history", kind: "local" },
  { name: "/color", description: "Set prompt bar color", kind: "cli" },
  { name: "/compact", description: "Compact conversation history", kind: "local" },
  { name: "/config", description: "Open settings", kind: "local" },
  { name: "/context", description: "Visualize context usage", kind: "local" },
  { name: "/copy", description: "Copy last response to clipboard", kind: "local" },
  { name: "/cost", description: "Show token usage & cost", kind: "local" },
  { name: "/desktop", description: "Continue session in Desktop app", kind: "cli" },
  { name: "/diff", description: "Open diff viewer for uncommitted changes", kind: "cli" },
  { name: "/doctor", description: "Run diagnostics", kind: "cli" },
  { name: "/effort", description: "Set model effort level", kind: "cli" },
  { name: "/exit", description: "Exit the CLI", kind: "cli" },
  { name: "/export", description: "Export conversation as text", kind: "cli" },
  { name: "/fast", description: "Toggle fast mode", kind: "cli" },
  { name: "/help", description: "Show help & available commands", kind: "cli" },
  { name: "/hooks", description: "View hook configurations", kind: "cli" },
  { name: "/ide", description: "Manage IDE integrations", kind: "cli" },
  { name: "/init", description: "Initialize project with CLAUDE.md", kind: "cli" },
  { name: "/keybindings", description: "Open keybindings config", kind: "cli" },
  { name: "/login", description: "Sign in to Anthropic account", kind: "cli" },
  { name: "/logout", description: "Sign out from Anthropic account", kind: "cli" },
  { name: "/mcp", description: "Manage MCP servers", kind: "cli" },
  { name: "/memory", description: "Edit CLAUDE.md & manage memory", kind: "cli" },
  { name: "/model", description: "Select or change AI model", kind: "cli" },
  { name: "/permissions", description: "View & manage permissions", kind: "cli" },
  { name: "/plan", description: "Enter plan mode", kind: "cli" },
  { name: "/plugin", description: "Manage Claude Code plugins", kind: "cli" },
  { name: "/pr-comments", description: "Fetch GitHub PR comments", kind: "cli" },
  { name: "/release-notes", description: "View full changelog", kind: "cli" },
  { name: "/rename", description: "Rename the current session", kind: "cli" },
  { name: "/resume", description: "Resume a conversation", kind: "cli" },
  { name: "/rewind", description: "Rewind conversation to a checkpoint", kind: "cli" },
  { name: "/schedule", description: "Manage scheduled tasks", kind: "cli" },
  { name: "/skills", description: "List available skills", kind: "cli" },
  { name: "/stats", description: "Visualize usage & session history", kind: "cli" },
  { name: "/status", description: "Show version, model & connectivity", kind: "cli" },
  { name: "/statusline", description: "Configure the status line", kind: "cli" },
  { name: "/tasks", description: "List & manage background tasks", kind: "cli" },
  { name: "/terminal-setup", description: "Configure terminal keybindings", kind: "cli" },
  { name: "/theme", description: "Change color theme", kind: "cli" },
  { name: "/upgrade", description: "Upgrade to higher plan tier", kind: "cli" },
  { name: "/usage", description: "Show plan usage & rate limits", kind: "cli" },
  { name: "/vim", description: "Toggle vim editing mode", kind: "cli" },
  { name: "/voice", description: "Toggle push-to-talk voice dictation", kind: "cli" },
];

/** File stats tracked per session for the file tree */
export interface FileStats {
  path: string;
  added: number;
  removed: number;
  reads: number;
  writes: number;
}

/** Extract file stats from messages — tracks which files were touched and diff stats */
export function extractFileStats(messages: ChatMessage[]): Map<string, FileStats> {
  const stats = new Map<string, FileStats>();

  function getOrCreate(path: string): FileStats {
    let s = stats.get(path);
    if (!s) {
      s = { path, added: 0, removed: 0, reads: 0, writes: 0 };
      stats.set(path, s);
    }
    return s;
  }

  function countLines(text: unknown): number {
    if (typeof text !== "string" || !text) return 0;
    return text.split("\n").length;
  }

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "tool_call") continue;
      const tc = block.toolCall;
      const input = tc.input;
      const filePath = input.file_path as string | undefined;

      switch (tc.name) {
        case "Edit": {
          if (!filePath) break;
          const s = getOrCreate(filePath);
          const oldLines = countLines(input.old_string);
          const newLines = countLines(input.new_string);
          if (newLines > oldLines) s.added += newLines - oldLines;
          else if (oldLines > newLines) s.removed += oldLines - newLines;
          // Even if same line count, there were changes
          if (oldLines === newLines && oldLines > 0) { s.added += 1; s.removed += 1; }
          s.writes++;
          break;
        }
        case "Write": {
          if (!filePath) break;
          const s = getOrCreate(filePath);
          s.added += countLines(input.content);
          s.writes++;
          break;
        }
        case "Read": {
          if (!filePath) break;
          const s = getOrCreate(filePath);
          s.reads++;
          break;
        }
        case "Glob":
        case "Grep": {
          // Extract file paths from results
          if (tc.result) {
            const lines = tc.result.split("\n").filter(l => l.trim());
            for (const line of lines) {
              // Only consider lines that look like file paths
              if (line.match(/^[A-Za-z]?:?[\\/]/) || line.match(/^\.?\//)) {
                const p = line.trim();
                if (p && !stats.has(p)) {
                  // Just mark as referenced, don't increment reads
                  getOrCreate(p);
                }
              }
            }
          }
          break;
        }
      }
    }
  }

  return stats;
}

/** A single file change event (Edit or Write) for the change tracker */
export interface FileChange {
  /** Which tool made the change */
  tool: "Edit" | "Write";
  /** Absolute file path */
  filePath: string;
  /** Old content (Edit only) */
  oldString?: string;
  /** New content */
  newString?: string;
  /** Full file content (Write only) */
  content?: string;
  /** When the change happened */
  timestamp: number;
  /** Whether the tool call completed successfully */
  isComplete: boolean;
  /** Whether the tool call had an error */
  isError?: boolean;
}

/** Extract ordered file change events from messages */
export function extractFileChanges(messages: ChatMessage[]): FileChange[] {
  const changes: FileChange[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "tool_call") continue;
      const tc = block.toolCall;
      const filePath = tc.input.file_path as string | undefined;
      if (!filePath) continue;

      if (tc.name === "Edit") {
        changes.push({
          tool: "Edit",
          filePath,
          oldString: tc.input.old_string as string | undefined,
          newString: tc.input.new_string as string | undefined,
          timestamp: tc.startTime,
          isComplete: tc.isComplete,
          isError: tc.isError,
        });
      } else if (tc.name === "Write") {
        changes.push({
          tool: "Write",
          filePath,
          content: tc.input.content as string | undefined,
          timestamp: tc.startTime,
          isComplete: tc.isComplete,
          isError: tc.isError,
        });
      }
    }
  }

  return changes;
}

/** Tool icons (simple text-based) */
export const TOOL_ICONS: Record<string, string> = {
  Bash: "$",
  Read: "R",
  Edit: "E",
  Write: "W",
  Grep: "/",
  Glob: "*",
  Agent: "A",
  Thinking: "\u2026",
  WebFetch: "~",
  WebSearch: "?",
};

export function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || "#";
}

/** Theme preset — defines all CSS custom properties for a complete theme */
export interface ThemePreset {
  id: string;
  name: string;
  base: "dark" | "light";
  vars: Record<string, string>;
}

/** Built-in theme presets */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "midnight",
    name: "Midnight Cloak",
    base: "dark",
    vars: {
      "--bg-base": "#0b0b0e",
      "--accent-purple": "rgba(167, 139, 250, 0.9)",
      "--accent-purple-soft": "rgba(167, 139, 250, 0.15)",
      "--accent-blue": "rgba(130, 170, 255, 0.9)",
      "--accent-blue-soft": "rgba(130, 170, 255, 0.12)",
    },
  },
  {
    id: "daylight",
    name: "Daylight",
    base: "light",
    vars: {
      "--bg-base": "#f5f5f7",
      "--accent-purple": "rgba(124, 58, 237, 0.9)",
      "--accent-purple-soft": "rgba(124, 58, 237, 0.1)",
      "--accent-blue": "rgba(37, 99, 235, 0.9)",
      "--accent-blue-soft": "rgba(37, 99, 235, 0.08)",
    },
  },
  {
    id: "abyss",
    name: "Abyss",
    base: "dark",
    vars: {
      "--bg-base": "#050510",
      "--accent-purple": "rgba(100, 120, 255, 0.9)",
      "--accent-purple-soft": "rgba(100, 120, 255, 0.15)",
      "--accent-blue": "rgba(80, 180, 255, 0.9)",
      "--accent-blue-soft": "rgba(80, 180, 255, 0.12)",
      "--color-success": "rgba(60, 200, 160, 0.9)",
      "--color-success-soft": "rgba(60, 200, 160, 0.12)",
    },
  },
  {
    id: "ember",
    name: "Ember",
    base: "dark",
    vars: {
      "--bg-base": "#0e0808",
      "--accent-purple": "rgba(255, 140, 100, 0.9)",
      "--accent-purple-soft": "rgba(255, 140, 100, 0.15)",
      "--accent-blue": "rgba(255, 180, 120, 0.9)",
      "--accent-blue-soft": "rgba(255, 180, 120, 0.12)",
      "--color-success": "rgba(140, 220, 100, 0.9)",
      "--color-success-soft": "rgba(140, 220, 100, 0.12)",
    },
  },
  {
    id: "forest",
    name: "Forest",
    base: "dark",
    vars: {
      "--bg-base": "#060e08",
      "--accent-purple": "rgba(120, 220, 160, 0.9)",
      "--accent-purple-soft": "rgba(120, 220, 160, 0.12)",
      "--accent-blue": "rgba(100, 200, 180, 0.9)",
      "--accent-blue-soft": "rgba(100, 200, 180, 0.1)",
      "--color-success": "rgba(140, 230, 120, 0.9)",
      "--color-success-soft": "rgba(140, 230, 120, 0.12)",
    },
  },
  {
    id: "snow",
    name: "Snow",
    base: "light",
    vars: {
      "--bg-base": "#fafafa",
      "--accent-purple": "rgba(99, 102, 241, 0.9)",
      "--accent-purple-soft": "rgba(99, 102, 241, 0.1)",
      "--accent-blue": "rgba(59, 130, 246, 0.9)",
      "--accent-blue-soft": "rgba(59, 130, 246, 0.08)",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    base: "dark",
    vars: {
      "--bg-base": "#1a1a1e",
      "--bg-surface": "rgba(255, 255, 255, 0.03)",
      "--bg-elevated": "rgba(255, 255, 255, 0.05)",
      "--accent-purple": "rgba(160, 170, 190, 0.9)",
      "--accent-purple-soft": "rgba(160, 170, 190, 0.1)",
      "--accent-blue": "rgba(140, 160, 200, 0.85)",
      "--accent-blue-soft": "rgba(140, 160, 200, 0.1)",
      "--color-success": "rgba(120, 200, 150, 0.85)",
      "--color-success-soft": "rgba(120, 200, 150, 0.1)",
    },
  },
  {
    id: "obsidian",
    name: "Obsidian",
    base: "dark",
    vars: {
      "--bg-base": "#000000",
      "--bg-surface": "rgba(255, 255, 255, 0.03)",
      "--bg-elevated": "rgba(255, 255, 255, 0.05)",
      "--accent-purple": "rgba(220, 220, 230, 0.9)",
      "--accent-purple-soft": "rgba(220, 220, 230, 0.08)",
      "--accent-blue": "rgba(180, 190, 210, 0.85)",
      "--accent-blue-soft": "rgba(180, 190, 210, 0.08)",
      "--color-success": "rgba(130, 210, 160, 0.85)",
      "--color-success-soft": "rgba(130, 210, 160, 0.1)",
    },
  },
  {
    id: "slate",
    name: "Slate",
    base: "dark",
    vars: {
      "--bg-base": "#1e2028",
      "--bg-surface": "rgba(255, 255, 255, 0.025)",
      "--bg-elevated": "rgba(255, 255, 255, 0.04)",
      "--accent-purple": "rgba(120, 150, 200, 0.9)",
      "--accent-purple-soft": "rgba(120, 150, 200, 0.12)",
      "--accent-blue": "rgba(100, 140, 190, 0.85)",
      "--accent-blue-soft": "rgba(100, 140, 190, 0.1)",
      "--color-success": "rgba(100, 200, 160, 0.85)",
      "--color-success-soft": "rgba(100, 200, 160, 0.1)",
    },
  },
  {
    id: "concrete",
    name: "Concrete",
    base: "light",
    vars: {
      "--bg-base": "#e8e8ec",
      "--bg-surface": "rgba(0, 0, 0, 0.03)",
      "--bg-elevated": "rgba(0, 0, 0, 0.05)",
      "--accent-purple": "rgba(80, 85, 100, 0.9)",
      "--accent-purple-soft": "rgba(80, 85, 100, 0.1)",
      "--accent-blue": "rgba(70, 95, 140, 0.85)",
      "--accent-blue-soft": "rgba(70, 95, 140, 0.08)",
      "--color-success": "rgba(40, 140, 80, 0.85)",
      "--color-success-soft": "rgba(40, 140, 80, 0.08)",
    },
  },
  {
    id: "carbon",
    name: "Carbon",
    base: "dark",
    vars: {
      "--bg-base": "#121212",
      "--bg-surface": "rgba(255, 255, 255, 0.04)",
      "--bg-elevated": "rgba(255, 255, 255, 0.06)",
      "--accent-purple": "rgba(0, 200, 200, 0.85)",
      "--accent-purple-soft": "rgba(0, 200, 200, 0.1)",
      "--accent-blue": "rgba(0, 180, 220, 0.8)",
      "--accent-blue-soft": "rgba(0, 180, 220, 0.08)",
      "--color-success": "rgba(0, 210, 140, 0.85)",
      "--color-success-soft": "rgba(0, 210, 140, 0.1)",
    },
  },
  // ── Community / well-known themes ──
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    base: "dark",
    vars: {
      "--bg-base": "#1e1e2e",
      "--bg-surface": "rgba(205, 214, 244, 0.04)",
      "--bg-elevated": "rgba(205, 214, 244, 0.06)",
      "--accent-purple": "rgba(203, 166, 247, 0.9)",
      "--accent-purple-soft": "rgba(203, 166, 247, 0.15)",
      "--accent-blue": "rgba(137, 180, 250, 0.9)",
      "--accent-blue-soft": "rgba(137, 180, 250, 0.12)",
      "--color-success": "rgba(166, 227, 161, 0.9)",
      "--color-success-soft": "rgba(166, 227, 161, 0.12)",
      "--color-error": "rgba(243, 139, 168, 0.9)",
      "--color-error-soft": "rgba(243, 139, 168, 0.1)",
      "--color-warning": "rgba(249, 226, 175, 0.85)",
      "--color-warning-soft": "rgba(249, 226, 175, 0.12)",
    },
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    base: "light",
    vars: {
      "--bg-base": "#eff1f5",
      "--bg-surface": "rgba(76, 79, 105, 0.04)",
      "--bg-elevated": "rgba(76, 79, 105, 0.06)",
      "--accent-purple": "rgba(136, 57, 239, 0.9)",
      "--accent-purple-soft": "rgba(136, 57, 239, 0.1)",
      "--accent-blue": "rgba(30, 102, 245, 0.9)",
      "--accent-blue-soft": "rgba(30, 102, 245, 0.08)",
      "--color-success": "rgba(64, 160, 43, 0.9)",
      "--color-success-soft": "rgba(64, 160, 43, 0.1)",
      "--color-error": "rgba(210, 15, 57, 0.9)",
      "--color-error-soft": "rgba(210, 15, 57, 0.08)",
      "--color-warning": "rgba(223, 142, 29, 0.85)",
      "--color-warning-soft": "rgba(223, 142, 29, 0.1)",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    base: "dark",
    vars: {
      "--bg-base": "#282a36",
      "--bg-surface": "rgba(248, 248, 242, 0.04)",
      "--bg-elevated": "rgba(248, 248, 242, 0.06)",
      "--accent-purple": "rgba(189, 147, 249, 0.9)",
      "--accent-purple-soft": "rgba(189, 147, 249, 0.15)",
      "--accent-blue": "rgba(139, 233, 253, 0.9)",
      "--accent-blue-soft": "rgba(139, 233, 253, 0.1)",
      "--color-success": "rgba(80, 250, 123, 0.9)",
      "--color-success-soft": "rgba(80, 250, 123, 0.12)",
      "--color-error": "rgba(255, 85, 85, 0.9)",
      "--color-error-soft": "rgba(255, 85, 85, 0.1)",
      "--color-warning": "rgba(241, 250, 140, 0.85)",
      "--color-warning-soft": "rgba(241, 250, 140, 0.1)",
    },
  },
  {
    id: "nord",
    name: "Nord",
    base: "dark",
    vars: {
      "--bg-base": "#2e3440",
      "--bg-surface": "rgba(216, 222, 233, 0.04)",
      "--bg-elevated": "rgba(216, 222, 233, 0.06)",
      "--accent-purple": "rgba(180, 142, 173, 0.9)",
      "--accent-purple-soft": "rgba(180, 142, 173, 0.12)",
      "--accent-blue": "rgba(136, 192, 208, 0.9)",
      "--accent-blue-soft": "rgba(136, 192, 208, 0.1)",
      "--color-success": "rgba(163, 190, 140, 0.9)",
      "--color-success-soft": "rgba(163, 190, 140, 0.12)",
      "--color-error": "rgba(191, 97, 106, 0.9)",
      "--color-error-soft": "rgba(191, 97, 106, 0.1)",
      "--color-warning": "rgba(235, 203, 139, 0.85)",
      "--color-warning-soft": "rgba(235, 203, 139, 0.1)",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    base: "dark",
    vars: {
      "--bg-base": "#282828",
      "--bg-surface": "rgba(235, 219, 178, 0.04)",
      "--bg-elevated": "rgba(235, 219, 178, 0.06)",
      "--accent-purple": "rgba(211, 134, 155, 0.9)",
      "--accent-purple-soft": "rgba(211, 134, 155, 0.12)",
      "--accent-blue": "rgba(131, 165, 152, 0.9)",
      "--accent-blue-soft": "rgba(131, 165, 152, 0.1)",
      "--color-success": "rgba(184, 187, 38, 0.9)",
      "--color-success-soft": "rgba(184, 187, 38, 0.12)",
      "--color-error": "rgba(251, 73, 52, 0.9)",
      "--color-error-soft": "rgba(251, 73, 52, 0.1)",
      "--color-warning": "rgba(254, 128, 25, 0.85)",
      "--color-warning-soft": "rgba(254, 128, 25, 0.1)",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    base: "dark",
    vars: {
      "--bg-base": "#1a1b26",
      "--bg-surface": "rgba(169, 177, 214, 0.04)",
      "--bg-elevated": "rgba(169, 177, 214, 0.06)",
      "--accent-purple": "rgba(187, 154, 247, 0.9)",
      "--accent-purple-soft": "rgba(187, 154, 247, 0.15)",
      "--accent-blue": "rgba(122, 162, 247, 0.9)",
      "--accent-blue-soft": "rgba(122, 162, 247, 0.12)",
      "--color-success": "rgba(158, 206, 106, 0.9)",
      "--color-success-soft": "rgba(158, 206, 106, 0.12)",
      "--color-error": "rgba(247, 118, 142, 0.9)",
      "--color-error-soft": "rgba(247, 118, 142, 0.1)",
      "--color-warning": "rgba(224, 175, 104, 0.85)",
      "--color-warning-soft": "rgba(224, 175, 104, 0.1)",
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    base: "dark",
    vars: {
      "--bg-base": "#282c34",
      "--bg-surface": "rgba(171, 178, 191, 0.04)",
      "--bg-elevated": "rgba(171, 178, 191, 0.06)",
      "--accent-purple": "rgba(198, 120, 221, 0.9)",
      "--accent-purple-soft": "rgba(198, 120, 221, 0.12)",
      "--accent-blue": "rgba(97, 175, 239, 0.9)",
      "--accent-blue-soft": "rgba(97, 175, 239, 0.1)",
      "--color-success": "rgba(152, 195, 121, 0.9)",
      "--color-success-soft": "rgba(152, 195, 121, 0.12)",
      "--color-error": "rgba(224, 108, 117, 0.9)",
      "--color-error-soft": "rgba(224, 108, 117, 0.1)",
      "--color-warning": "rgba(229, 192, 123, 0.85)",
      "--color-warning-soft": "rgba(229, 192, 123, 0.1)",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    base: "dark",
    vars: {
      "--bg-base": "#272822",
      "--bg-surface": "rgba(248, 248, 242, 0.04)",
      "--bg-elevated": "rgba(248, 248, 242, 0.06)",
      "--accent-purple": "rgba(174, 129, 255, 0.9)",
      "--accent-purple-soft": "rgba(174, 129, 255, 0.12)",
      "--accent-blue": "rgba(102, 217, 239, 0.9)",
      "--accent-blue-soft": "rgba(102, 217, 239, 0.1)",
      "--color-success": "rgba(166, 226, 46, 0.9)",
      "--color-success-soft": "rgba(166, 226, 46, 0.12)",
      "--color-error": "rgba(249, 38, 114, 0.9)",
      "--color-error-soft": "rgba(249, 38, 114, 0.1)",
      "--color-warning": "rgba(230, 219, 116, 0.85)",
      "--color-warning-soft": "rgba(230, 219, 116, 0.1)",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    base: "dark",
    vars: {
      "--bg-base": "#002b36",
      "--bg-surface": "rgba(147, 161, 161, 0.05)",
      "--bg-elevated": "rgba(147, 161, 161, 0.07)",
      "--accent-purple": "rgba(108, 113, 196, 0.9)",
      "--accent-purple-soft": "rgba(108, 113, 196, 0.15)",
      "--accent-blue": "rgba(38, 139, 210, 0.9)",
      "--accent-blue-soft": "rgba(38, 139, 210, 0.12)",
      "--color-success": "rgba(133, 153, 0, 0.9)",
      "--color-success-soft": "rgba(133, 153, 0, 0.12)",
      "--color-error": "rgba(220, 50, 47, 0.9)",
      "--color-error-soft": "rgba(220, 50, 47, 0.1)",
      "--color-warning": "rgba(181, 137, 0, 0.85)",
      "--color-warning-soft": "rgba(181, 137, 0, 0.1)",
    },
  },
];

/** Alpha levels used per color key — must match what app.css and components use */
const COLOR_ALPHAS: Record<string, number[]> = {
  "--accent-purple": [0, 0.03, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1],
  "--accent-blue": [0.04, 0.06, 0.08, 0.12, 0.3, 0.4, 0.9],
  "--color-success": [0.08, 0.1, 0.12, 0.15, 0.2, 0.3, 0.7, 0.85, 0.9],
  "--color-error": [0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.35, 0.4, 0.7, 0.8, 0.85, 0.9],
  "--color-warning": [0.1, 0.12, 0.85],
};

function alphaVarName(key: string, alpha: number): string {
  const suffix = alpha === 0 ? "00" : alpha === 1 ? "100" : String(Math.round(alpha * 100)).padStart(2, "0");
  return `${key}-${suffix}`;
}

/** Vars auto-derived from --bg-base so structural elements follow the theme */
const BG_DERIVED_VARS = ["--bg-glass", "--bg-glass-hover", "--glass-panel-bg", "--panel-tooltip-bg"];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function clamp(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }

function deriveBgVars(root: HTMLElement, bgBase: string) {
  const rgb = hexToRgb(bgBase);
  if (!rgb) return;
  const [r, g, b] = rgb;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (brightness > 128) {
    // Light theme: glass is slightly darker than base
    root.style.setProperty("--bg-glass", `rgba(${clamp(r - 5)}, ${clamp(g - 5)}, ${clamp(b - 5)}, 0.85)`);
    root.style.setProperty("--bg-glass-hover", `rgba(${clamp(r - 10)}, ${clamp(g - 10)}, ${clamp(b - 10)}, 0.9)`);
    root.style.setProperty("--glass-panel-bg", `rgba(${r}, ${g}, ${b}, 0.95)`);
    root.style.setProperty("--panel-tooltip-bg", `rgba(${r}, ${g}, ${b}, 0.96)`);
  } else {
    // Dark theme: glass is slightly lighter than base
    root.style.setProperty("--bg-glass", `rgba(${clamp(r + 8)}, ${clamp(g + 8)}, ${clamp(b + 8)}, 0.85)`);
    root.style.setProperty("--bg-glass-hover", `rgba(${clamp(r + 14)}, ${clamp(g + 14)}, ${clamp(b + 14)}, 0.9)`);
    root.style.setProperty("--glass-panel-bg", `rgba(${r}, ${g}, ${b}, 0.92)`);
    root.style.setProperty("--panel-tooltip-bg", `rgba(${clamp(r + 10)}, ${clamp(g + 10)}, ${clamp(b + 10)}, 0.96)`);
  }
}

/** Apply a theme preset to the document */
export function applyThemePreset(preset: ThemePreset) {
  const root = document.documentElement;
  root.setAttribute("data-theme", preset.base);
  for (const [key, value] of Object.entries(preset.vars)) {
    root.style.setProperty(key, value);
    // Auto-derive structural bg vars from --bg-base
    if (key === "--bg-base") deriveBgVars(root, value);
    // Generate pre-computed alpha variants as direct rgba() values
    if (key in COLOR_ALPHAS) {
      const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) {
        const [r, g, b] = [m[1], m[2], m[3]];
        root.style.setProperty(`${key}-rgb`, `${r}, ${g}, ${b}`);
        for (const alpha of COLOR_ALPHAS[key]) {
          root.style.setProperty(alphaVarName(key, alpha), `rgba(${r}, ${g}, ${b}, ${alpha})`);
        }
      }
    }
  }
}

/** Clear preset-specific overrides (revert to base theme defaults) */
export function clearThemeOverrides(vars: Record<string, string>) {
  const root = document.documentElement;
  for (const key of Object.keys(vars)) {
    root.style.removeProperty(key);
    if (key === "--bg-base") {
      for (const v of BG_DERIVED_VARS) root.style.removeProperty(v);
    }
    if (key in COLOR_ALPHAS) {
      root.style.removeProperty(`${key}-rgb`);
      for (const alpha of COLOR_ALPHAS[key]) {
        root.style.removeProperty(alphaVarName(key, alpha));
      }
    }
  }
}
