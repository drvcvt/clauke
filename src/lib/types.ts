/** Types for Claude stream-json events and UI state */

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
}

/** A content block — text, image, thinking, or a tool call, rendered in order */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; path: string }
  | { type: "tool_call"; toolCall: ToolCall };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
  timestamp: number;
}

export interface ClaudeEvent {
  type: string;
  tab_id?: string;
  [key: string]: unknown;
}

export type ClaudeModel = "sonnet" | "opus" | "haiku";
export type EffortLevel = "low" | "medium" | "high" | "max";
export type PermissionMode = "bypass" | "acceptEdits" | "plan" | "default";

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  bypass: "Bypass",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  default: "Ask",
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

/** Context window limits per model (in tokens) */
export const MODEL_CONTEXT_LIMITS: Record<ClaudeModel, number> = {
  opus: 1_000_000,
  sonnet: 200_000,
  haiku: 200_000,
};

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

/** Token usage stats for a single response or accumulated session */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

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

/** API pricing per million tokens (as of 2025) */
export const COST_PER_MILLION: Record<ClaudeModel, {
  input: number; output: number; cacheRead: number; cacheWrite: number;
}> = {
  sonnet: { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  opus:   { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  haiku:  { input: 0.80, output: 4, cacheRead: 0.08, cacheWrite: 1.00 },
};

/** Estimate dollar cost from token usage */
export function calculateCost(usage: TokenUsage, model: ClaudeModel): number {
  const r = COST_PER_MILLION[model];
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
  cwd: string;
  model: ClaudeModel;
  effort: EffortLevel;
  sessionId?: string;
  usage?: TokenUsage;
  /** Last input token count — approximates current context window fill level */
  contextTokens?: number;
  permissionMode: PermissionMode;
  /** Per-tab system prompt (overrides global default when set) */
  systemPrompt?: string;
  /** Additional directories Claude can access beyond CWD */
  addDirs?: string[];
  /** Selected agent name (from `claude agents`) */
  agent?: string;
  /** Timestamp when the current run started (for elapsed timer) */
  runStartTime?: number;
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
  /** Working directory */
  cwd: string;
  model: ClaudeModel;
  effort: EffortLevel;
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
  { name: "/compact", description: "Compact conversation history", kind: "cli" },
  { name: "/config", description: "Open settings", kind: "cli" },
  { name: "/context", description: "Visualize context usage", kind: "cli" },
  { name: "/copy", description: "Copy last response to clipboard", kind: "cli" },
  { name: "/cost", description: "Show token usage & cost", kind: "cli" },
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
