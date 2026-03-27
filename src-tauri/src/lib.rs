mod claude;

use claude::{ClaudeProcess, ClaudeRunner};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

/// Shared state: one Claude process per tab.
struct AppState {
    tabs: Arc<Mutex<HashMap<String, ClaudeProcess>>>,
    discord: Arc<Mutex<DiscordRpcState>>,
}

/// Discord Rich Presence state.
struct DiscordRpcState {
    client: Option<DiscordIpcClient>,
    enabled: bool,
    start_timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PromptRequest {
    prompt: String,
    /// Working directory for claude to operate in
    cwd: Option<String>,
    /// Tab ID this prompt belongs to
    tab_id: String,
    /// Claude model to use (e.g. "sonnet", "opus", "haiku")
    model: Option<String>,
    /// Effort level (currently informational)
    effort: Option<String>,
    /// Session ID for resuming a conversation
    session_id: Option<String>,
    /// Image file paths to attach
    images: Option<Vec<String>>,
    /// Whether to skip permission prompts
    skip_permissions: Option<bool>,
    /// Allowed tools (when not skipping permissions)
    allowed_tools: Option<Vec<String>>,
    /// Custom system prompt to append
    system_prompt: Option<String>,
    /// Additional directories Claude can access
    add_dirs: Option<Vec<String>>,
    /// Agent to use (from `claude agents`)
    agent: Option<String>,
    /// Continue the most recent session in this CWD
    continue_last: Option<bool>,
    /// Custom path to the claude binary (overrides "claude" in PATH)
    claude_path: Option<String>,
}

/// Send a prompt to Claude Code CLI and stream events back via Tauri events.
#[tauri::command]
async fn send_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PromptRequest,
) -> Result<(), String> {
    let tab_id = request.tab_id.clone();

    // Kill any running process for this tab
    {
        let mut guard = state.tabs.lock().await;
        if let Some(proc) = guard.remove(&tab_id) {
            proc.kill().await;
        }
    }

    let cwd = request.cwd.clone();
    let model = request.model.clone();
    let resume = request.session_id.clone();
    let images = request.images.clone().unwrap_or_default();
    let skip_perms = request.skip_permissions.unwrap_or(true);
    let allowed_tools = request.allowed_tools.clone().unwrap_or_default();
    let sys_prompt = request.system_prompt.clone();
    let add_dirs = request.add_dirs.clone().unwrap_or_default();
    let agent = request.agent.clone();
    let continue_last = request.continue_last.unwrap_or(false);
    let claude_path = request.claude_path.clone();
    let at_ref: Option<&[String]> = if allowed_tools.is_empty() { None } else { Some(&allowed_tools) };
    let mut runner =
        ClaudeRunner::spawn(
            &request.prompt,
            cwd.as_deref(),
            model.as_deref(),
            resume.as_deref(),
            &images,
            skip_perms,
            at_ref,
            sys_prompt.as_deref(),
            &add_dirs,
            agent.as_deref(),
            continue_last,
            claude_path.as_deref(),
        )
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let handle = runner.handle();

    // Store the process handle for cancellation
    {
        let mut guard = state.tabs.lock().await;
        guard.insert(tab_id.clone(), handle.clone());
    }

    // Stream events to frontend (events include tab_id)
    let result = runner.stream_events(&app, &tab_id).await;

    // Clear process handle and signal done
    let is_current = {
        let mut guard = state.tabs.lock().await;
        if guard.get(&tab_id).is_some_and(|c| c.is_same(&handle)) {
            guard.remove(&tab_id);
            true
        } else {
            !guard.contains_key(&tab_id)
        }
    };

    if is_current {
        app.emit("claude-done", &tab_id).map_err(|e| e.to_string())?;
    }

    result
}

/// Save clipboard image bytes to a temp file and return the path.
#[tauri::command]
async fn save_clipboard_image(data: Vec<u8>, mime: String) -> Result<String, String> {
    let ext = match mime.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };
    let temp_dir = std::env::temp_dir().join("clauke-clipboard");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let filename = format!("clipboard-{}.{}", uuid::Uuid::new_v4(), ext);
    let path = temp_dir.join(&filename);
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// A slash command discovered from the filesystem.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct DiscoveredCommand {
    name: String,
    description: String,
    /// "local" (handled by clauke), "cli" (built-in CLI command), "custom" (user/plugin skill)
    kind: String,
    /// Where it came from: "builtin", "user", "project", or plugin name
    source: String,
}

/// Discover custom slash commands from ~/.claude/commands/ , project .claude/commands/,
/// and installed plugin commands.
#[tauri::command]
async fn list_slash_commands(cwd: Option<String>) -> Result<Vec<DiscoveredCommand>, String> {
    let mut commands: Vec<DiscoveredCommand> = Vec::new();

    // ── 1. User-level commands: ~/.claude/commands/*.md ──
    if let Some(home) = dirs::home_dir() {
        let user_cmds = home.join(".claude").join("commands");
        collect_commands_from_dir(&user_cmds, "user", &mut commands);
    }

    // ── 2. Project-level commands: <cwd>/.claude/commands/*.md ──
    if let Some(ref dir) = cwd {
        let project_cmds = PathBuf::from(dir).join(".claude").join("commands");
        collect_commands_from_dir(&project_cmds, "project", &mut commands);
    }

    // ── 3. Plugin commands from installed plugins ──
    if let Some(home) = dirs::home_dir() {
        let plugins_json = home
            .join(".claude")
            .join("plugins")
            .join("installed_plugins.json");
        if let Ok(content) = std::fs::read_to_string(&plugins_json) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(plugins) = parsed.get("plugins").and_then(|p| p.as_object()) {
                    for (plugin_key, entries) in plugins {
                        // plugin_key looks like "agent-sdk-dev@claude-plugins-official"
                        let plugin_name = plugin_key.split('@').next().unwrap_or(plugin_key);
                        // Use the last entry (most recently installed version)
                        if let Some(arr) = entries.as_array() {
                            if let Some(entry) = arr.last() {
                                if let Some(install_path) =
                                    entry.get("installPath").and_then(|p| p.as_str())
                                {
                                    let cmds_dir = PathBuf::from(install_path).join("commands");
                                    collect_commands_from_dir(
                                        &cmds_dir,
                                        &format!("plugin:{}", plugin_name),
                                        &mut commands,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Deduplicate: keep the first occurrence (user > project > plugin)
    let mut seen = std::collections::HashSet::new();
    commands.retain(|cmd| seen.insert(cmd.name.clone()));

    Ok(commands)
}

/// Read .md files from a directory and extract command name + description.
/// Parses YAML frontmatter (description field) and falls back to first `# heading`.
/// Skips commands whose description starts with "Deprecated".
fn collect_commands_from_dir(dir: &PathBuf, source: &str, out: &mut Vec<DiscoveredCommand>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let name = format!("/{}", stem);

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Try to extract description from YAML frontmatter (--- delimited)
        let description = extract_frontmatter_description(&content)
            .or_else(|| {
                content
                    .lines()
                    .find(|l| l.starts_with("# "))
                    .map(|l| l.trim_start_matches("# ").to_string())
            })
            .unwrap_or_else(|| stem.to_string());

        // Skip deprecated commands
        let desc_lower = description.to_lowercase();
        if desc_lower.starts_with("deprecated") {
            continue;
        }

        out.push(DiscoveredCommand {
            name,
            description,
            kind: "custom".to_string(),
            source: source.to_string(),
        });
    }
}

/// Extract the `description` field from YAML frontmatter (between `---` markers).
fn extract_frontmatter_description(content: &str) -> Option<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    // Find the closing ---
    let after_open = &trimmed[3..].trim_start_matches(['\r', '\n']);
    let end = after_open.find("\n---").or_else(|| after_open.find("\r\n---"))?;
    let frontmatter = &after_open[..end];

    // Simple key: value parsing for description
    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("description:") {
            let val = rest.trim().trim_matches('"').trim_matches('\'');
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Send a steering message to the running Claude process in a specific tab.
#[tauri::command]
async fn steer_claude(state: State<'_, AppState>, tab_id: String, message: String) -> Result<(), String> {
    let guard = state.tabs.lock().await;
    if let Some(proc) = guard.get(&tab_id) {
        proc.steer(&message).await
    } else {
        Err("No running process for this tab".to_string())
    }
}

/// Stop the Claude process running in a specific tab.
#[tauri::command]
async fn stop_claude(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let mut guard = state.tabs.lock().await;
    if let Some(proc) = guard.remove(&tab_id) {
        proc.kill().await;
    }
    Ok(())
}

/// Clean up old clipboard images from temp directory.
/// Returns the number of files deleted.
fn cleanup_old_images(max_age_days: u64) -> u32 {
    let temp_dir = std::env::temp_dir().join("clauke-clipboard");
    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(max_age_days * 86400);
    let mut deleted = 0u32;
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            let modified = meta.modified().unwrap_or(std::time::SystemTime::now());
            if modified < cutoff {
                if std::fs::remove_file(entry.path()).is_ok() {
                    deleted += 1;
                }
            }
        }
    }
    deleted
}

/// Tauri command: clean up clipboard images older than `max_age_days`.
#[tauri::command]
async fn cleanup_clipboard(max_age_days: u64) -> Result<u32, String> {
    Ok(cleanup_old_images(max_age_days))
}

// ── MCP Server management ──

#[derive(Debug, Serialize, Deserialize, Clone)]
struct McpServerEntry {
    name: String,
    #[serde(rename = "type")]
    server_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct McpHealthResult {
    name: String,
    healthy: bool,
    error: Option<String>,
}

fn claude_settings_path() -> Result<std::path::PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".claude").join("settings.json"))
        .ok_or_else(|| "Could not find home directory".to_string())
}

fn read_claude_settings() -> Result<serde_json::Value, String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_claude_settings(settings: &serde_json::Value) -> Result<(), String> {
    let path = claude_settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// List all configured MCP servers from ~/.claude/settings.json
#[tauri::command]
async fn list_mcp_servers() -> Result<Vec<McpServerEntry>, String> {
    let settings = read_claude_settings()?;
    let mut servers = Vec::new();

    if let Some(mcp) = settings.get("mcpServers").and_then(|v| v.as_object()) {
        for (name, config) in mcp {
            let server_type = config
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("stdio")
                .to_string();

            let (command, args, env, url) = match server_type.as_str() {
                "http" | "sse" => {
                    let url = config.get("url").and_then(|v| v.as_str()).map(String::from);
                    (None, None, None, url)
                }
                _ => {
                    let command = config
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let args: Option<Vec<String>> = config
                        .get("args")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        });
                    let env: Option<HashMap<String, String>> = config
                        .get("env")
                        .and_then(|v| v.as_object())
                        .map(|obj| {
                            obj.iter()
                                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                                .collect()
                        });
                    (command, args, env, None)
                }
            };

            servers.push(McpServerEntry {
                name: name.clone(),
                server_type,
                command,
                args,
                env,
                url,
            });
        }
    }

    Ok(servers)
}

/// Add or update an MCP server in ~/.claude/settings.json
#[tauri::command]
async fn add_mcp_server(
    name: String,
    server_type: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    url: Option<String>,
) -> Result<(), String> {
    let mut settings = read_claude_settings()?;

    let mcp_servers = settings
        .as_object_mut()
        .ok_or("Settings is not an object")?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    let server_config = match server_type.as_str() {
        "http" | "sse" => serde_json::json!({
            "type": server_type,
            "url": url.unwrap_or_default(),
        }),
        _ => {
            // stdio — omit "type" field to match Claude Code convention
            let mut config = serde_json::json!({
                "command": command.unwrap_or_default(),
                "args": args.unwrap_or_default(),
            });
            let env_map = env.unwrap_or_default();
            if !env_map.is_empty() {
                config["env"] = serde_json::to_value(env_map).unwrap_or_default();
            }
            config
        }
    };

    mcp_servers
        .as_object_mut()
        .ok_or("mcpServers is not an object")?
        .insert(name, server_config);

    write_claude_settings(&settings)
}

/// Remove an MCP server from ~/.claude/settings.json
#[tauri::command]
async fn remove_mcp_server(name: String) -> Result<(), String> {
    let mut settings = read_claude_settings()?;

    if let Some(mcp) = settings.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        mcp.remove(&name);
    }

    write_claude_settings(&settings)
}

/// Check if an MCP server is reachable / healthy
#[tauri::command]
async fn check_mcp_server(
    name: String,
    server_type: String,
    command: Option<String>,
    url: Option<String>,
) -> McpHealthResult {
    match server_type.as_str() {
        "http" | "sse" => {
            let Some(url_str) = url else {
                return McpHealthResult {
                    name,
                    healthy: false,
                    error: Some("no URL configured".into()),
                };
            };
            match reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .danger_accept_invalid_certs(true)
                .build()
            {
                Ok(client) => match client.get(&url_str).send().await {
                    Ok(resp) => {
                        let status = resp.status().as_u16();
                        // 2xx-4xx means the server is up (MCP may reject bare GET)
                        if status < 500 {
                            McpHealthResult {
                                name,
                                healthy: true,
                                error: None,
                            }
                        } else {
                            McpHealthResult {
                                name,
                                healthy: false,
                                error: Some(format!("HTTP {}", status)),
                            }
                        }
                    }
                    Err(e) => McpHealthResult {
                        name,
                        healthy: false,
                        error: Some(e.to_string()),
                    },
                },
                Err(e) => McpHealthResult {
                    name,
                    healthy: false,
                    error: Some(e.to_string()),
                },
            }
        }
        _ => {
            // stdio: check if the command exists in PATH
            let cmd = command.unwrap_or_default();
            if cmd.is_empty() {
                return McpHealthResult {
                    name,
                    healthy: false,
                    error: Some("no command configured".into()),
                };
            }
            let healthy = is_in_path(&cmd);
            McpHealthResult {
                name,
                healthy,
                error: if healthy {
                    None
                } else {
                    Some(format!("'{}' not found in PATH", cmd))
                },
            }
        }
    }
}

// ── Hooks management ──

#[derive(Debug, Serialize, Deserialize, Clone)]
struct HookAction {
    #[serde(rename = "type")]
    hook_type: String,
    command: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct HookRule {
    matcher: String,
    hooks: Vec<HookAction>,
}

/// List all configured hooks from ~/.claude/settings.json
#[tauri::command]
async fn list_hooks() -> Result<HashMap<String, Vec<HookRule>>, String> {
    let settings = read_claude_settings()?;
    let mut result: HashMap<String, Vec<HookRule>> = HashMap::new();

    if let Some(hooks) = settings.get("hooks").and_then(|v| v.as_object()) {
        for (event, rules) in hooks {
            if let Some(arr) = rules.as_array() {
                let parsed: Vec<HookRule> = arr
                    .iter()
                    .filter_map(|rule| {
                        let matcher = rule.get("matcher")?.as_str()?.to_string();
                        let hook_actions: Vec<HookAction> = rule
                            .get("hooks")?
                            .as_array()?
                            .iter()
                            .filter_map(|h| {
                                Some(HookAction {
                                    hook_type: h.get("type")?.as_str()?.to_string(),
                                    command: h.get("command")?.as_str()?.to_string(),
                                })
                            })
                            .collect();
                        Some(HookRule {
                            matcher,
                            hooks: hook_actions,
                        })
                    })
                    .collect();
                result.insert(event.clone(), parsed);
            }
        }
    }

    Ok(result)
}

/// Add a hook rule to ~/.claude/settings.json
#[tauri::command]
async fn add_hook(event: String, matcher: String, command: String) -> Result<(), String> {
    let mut settings = read_claude_settings()?;

    let hooks = settings
        .as_object_mut()
        .ok_or("Settings is not an object")?
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));

    let event_rules = hooks
        .as_object_mut()
        .ok_or("hooks is not an object")?
        .entry(&event)
        .or_insert_with(|| serde_json::json!([]));

    let new_rule = serde_json::json!({
        "matcher": matcher,
        "hooks": [{ "type": "command", "command": command }]
    });

    event_rules
        .as_array_mut()
        .ok_or("hook event is not an array")?
        .push(new_rule);

    write_claude_settings(&settings)
}

/// Remove a hook rule by event and index
#[tauri::command]
async fn remove_hook(event: String, index: usize) -> Result<(), String> {
    let mut settings = read_claude_settings()?;

    if let Some(hooks) = settings.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        if let Some(rules) = hooks.get_mut(&event).and_then(|v| v.as_array_mut()) {
            if index < rules.len() {
                rules.remove(index);
            }
            // Clean up empty event arrays
            if rules.is_empty() {
                hooks.remove(&event);
            }
        }
    }

    write_claude_settings(&settings)
}

/// Generate a short title for a conversation given the first user prompt.
/// Uses claude CLI with haiku for speed.
#[tauri::command]
async fn generate_title(prompt: String, claude_path: Option<String>) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(claude_path.as_deref().unwrap_or("claude"));
    cmd.args([
        "-p",
        &format!("Generate a very short title (max 5 words, no quotes, no punctuation at end) for a conversation that starts with this prompt: {}", prompt),
        "--output-format", "text",
        "--model", "haiku",
    ]);

    // Prevent a console window from flashing on Windows
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if title.is_empty() {
        return Err("Empty response".to_string());
    }
    // Cap at 30 chars (char-safe to avoid UTF-8 panic on multi-byte chars)
    let title = if title.chars().count() > 30 {
        let truncated: String = title.chars().take(29).collect();
        format!("{truncated}…")
    } else {
        title
    };
    Ok(title)
}

// ── Persistent storage (replaces localStorage) ──

/// Get the clauke data directory (~/.clauke/ or AppData/clauke/)
fn data_dir() -> Result<std::path::PathBuf, String> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or("Could not find data directory")?;
    Ok(base.join("clauke"))
}

/// Read a JSON file from the clauke data directory.
#[tauri::command]
async fn storage_read(key: String) -> Result<Option<String>, String> {
    let path = data_dir()?.join(format!("{}.json", key));
    if !path.exists() {
        return Ok(None);
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(content))
}

/// Write a JSON string to a file in the clauke data directory.
#[tauri::command]
async fn storage_write(key: String, value: String) -> Result<(), String> {
    let dir = data_dir()?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", key));
    tokio::fs::write(&path, value.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

/// Delete a file from the clauke data directory.
#[tauri::command]
async fn storage_delete(key: String) -> Result<(), String> {
    let path = data_dir()?.join(format!("{}.json", key));
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// An agent entry parsed from `claude agents` output.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct AgentEntry {
    name: String,
    model: String,
    source: String,
}

/// List available agents by running `claude agents` and parsing the output.
#[tauri::command]
async fn list_agents() -> Result<Vec<AgentEntry>, String> {
    let mut cmd = tokio::process::Command::new("claude");
    cmd.arg("agents");

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run `claude agents`: {}", e))?;

    let text = String::from_utf8_lossy(&output.stdout);
    let mut agents = Vec::new();
    let mut current_source = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        // Section headers like "User agents:", "Built-in agents:", "Plugin agents:"
        if trimmed.ends_with("agents:") || trimmed.ends_with("agents :") {
            current_source = trimmed
                .trim_end_matches(':')
                .trim_end_matches(" agents")
                .trim()
                .to_string();
            continue;
        }
        // Agent lines: "  name . model" or "  name:subname . model"
        if let Some(dot_pos) = trimmed.find(" . ") {
            let name = trimmed[..dot_pos].trim().to_string();
            let model = trimmed[dot_pos + 3..].trim().to_string();
            if !name.is_empty() {
                agents.push(AgentEntry {
                    name,
                    model,
                    source: current_source.clone(),
                });
            }
        }
    }

    Ok(agents)
}

/// Return the CLI interaction mode so the frontend knows whether steering is available.
#[tauri::command]
async fn get_cli_mode() -> String {
    "interactive".to_string()
}

// ── File explorer ──

#[derive(Debug, Serialize, Deserialize)]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    extension: Option<String>,
}

/// List directory contents for the file explorer.
#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<FsEntry>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Ok(vec![]);
    }

    let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let hidden = [".git", "node_modules", "__pycache__"];

    let mut entries: Vec<FsEntry> = read_dir
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if hidden.contains(&name.as_str()) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let is_dir = meta.is_dir();
            Some(FsEntry {
                extension: if is_dir {
                    None
                } else {
                    entry.path().extension().and_then(|e| e.to_str()).map(String::from)
                },
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir,
                size: if is_dir { 0 } else { meta.len() },
            })
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

// ── Editor management ──

#[derive(Debug, Serialize, Deserialize, Clone)]
struct EditorInfo {
    id: String,
    name: String,
    command: String,
}

fn is_in_path(cmd: &str) -> bool {
    let mut check = std::process::Command::new(if cfg!(windows) { "where" } else { "which" });
    check.arg(cmd);
    check.stdout(std::process::Stdio::null());
    check.stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        check.creation_flags(CREATE_NO_WINDOW);
    }
    check.status().map(|s| s.success()).unwrap_or(false)
}

/// Detect available code editors on the system.
#[tauri::command]
async fn detect_editors() -> Vec<EditorInfo> {
    let candidates = [
        ("vscode", "VS Code", "code"),
        ("cursor", "Cursor", "cursor"),
        ("sublime", "Sublime Text", "subl"),
        ("neovim", "Neovim", "nvim"),
        ("antigravity", "Antigravity", "antigravity"),
    ];

    candidates
        .iter()
        .filter(|(_, _, cmd)| is_in_path(cmd))
        .map(|(id, name, cmd)| EditorInfo {
            id: id.to_string(),
            name: name.to_string(),
            command: cmd.to_string(),
        })
        .collect()
}

/// Verify that the Claude CLI is accessible and return its version string.
#[tauri::command]
async fn check_claude_cli(custom_path: Option<String>) -> Result<String, String> {
    let cmd_name = custom_path.as_deref().unwrap_or("claude");
    let mut cmd = std::process::Command::new(cmd_name);
    cmd.arg("--version");
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().map_err(|e| format!("not found: {}", e))?;
    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if version.is_empty() { "found".to_string() } else { version })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { "unknown error".to_string() } else { stderr })
    }
}

/// Open a file in the preferred editor, with the project folder as workspace.
#[tauri::command]
async fn open_in_editor(editor: String, file: String, cwd: String) -> Result<(), String> {
    let mut cmd = match editor.as_str() {
        "vscode" => {
            // On Windows, `code` is a .cmd wrapper — use cmd /c to launch it
            let mut c = std::process::Command::new("cmd");
            c.args(["/c", "code", "--reuse-window", &cwd, "--goto", &file]);
            c
        }
        "cursor" => {
            let mut c = std::process::Command::new("cmd");
            c.args(["/c", "cursor", "--reuse-window", &cwd, "--goto", &file]);
            c
        }
        "sublime" => {
            let mut c = std::process::Command::new("cmd");
            c.args(["/c", "subl", &cwd, &file]);
            c
        }
        "neovim" => {
            if is_in_path("wt") {
                let mut c = std::process::Command::new("wt");
                c.args(["-d", &cwd, "nvim", &file]);
                c
            } else {
                let mut c = std::process::Command::new("cmd");
                c.args([
                    "/c", "start", "cmd", "/k",
                    &format!("cd /d \"{}\" && nvim \"{}\"", cwd, file),
                ]);
                c
            }
        }
        "antigravity" => {
            let mut c = std::process::Command::new("cmd");
            c.args(["/c", "antigravity", &cwd, "--goto", &file]);
            c
        }
        _ => return Err(format!("Unknown editor: {}", editor)),
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| format!("Failed to open editor: {}", e))?;
    Ok(())
}

/// Read file contents for the built-in editor.
#[tauri::command]
async fn read_file_contents(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Write file contents from the built-in editor.
#[tauri::command]
async fn write_file_contents(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

// ── Discord Rich Presence ──

/// The Discord Application ID for clauke.
/// Create your own at https://discord.com/developers/applications if needed.
const DISCORD_APP_ID: &str = "1334718443118788670";

/// Toggle Discord Rich Presence on or off. Persists the preference.
#[tauri::command]
async fn toggle_discord_rpc(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut rpc = state.discord.lock().await;
    rpc.enabled = enabled;

    if enabled {
        if rpc.client.is_none() {
            let mut client = DiscordIpcClient::new(DISCORD_APP_ID);
            if client.connect().is_ok() {
                rpc.start_timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                let ts = rpc.start_timestamp;
                let _ = client.set_activity(
                    activity::Activity::new()
                        .state("Idle")
                        .details("Using Clauke")
                        .timestamps(activity::Timestamps::new().start(ts))
                        .assets(
                            activity::Assets::new()
                                .large_image("clauke_icon")
                                .large_text("Clauke - Claude Code Wrapper"),
                        ),
                );
                rpc.client = Some(client);
            }
        }
    } else if let Some(ref mut client) = rpc.client {
        let _ = client.clear_activity();
        let _ = client.close();
        rpc.client = None;
    }

    // Persist preference
    drop(rpc);
    let dir = data_dir()?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let path = dir.join("discord_rpc.json");
    let value = serde_json::json!({ "enabled": enabled }).to_string();
    tokio::fs::write(&path, value.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update the Discord Rich Presence activity. Called by the frontend on state transitions.
#[tauri::command]
async fn update_discord_rpc(
    state: State<'_, AppState>,
    model: String,
    activity_str: String,
    message_count: u32,
) -> Result<(), String> {
    let mut rpc = state.discord.lock().await;
    if !rpc.enabled {
        return Ok(());
    }
    let ts = rpc.start_timestamp;
    let client = match rpc.client.as_mut() {
        Some(c) => c,
        None => return Ok(()),
    };

    let details = format!("Using {} - {} msgs", model, message_count);
    let state_text = if activity_str == "thinking" {
        "Thinking...".to_string()
    } else if activity_str == "idle" {
        "Idle".to_string()
    } else if let Some(tool) = activity_str.strip_prefix("tool:") {
        format!("Running {}", tool)
    } else {
        activity_str
    };

    let _ = client.set_activity(
        activity::Activity::new()
            .state(&state_text)
            .details(&details)
            .timestamps(activity::Timestamps::new().start(ts))
            .assets(
                activity::Assets::new()
                    .large_image("clauke_icon")
                    .large_text("Clauke - Claude Code Wrapper"),
            ),
    );
    Ok(())
}

/// Check if Discord RPC is enabled (reads persisted preference).
#[tauri::command]
async fn get_discord_rpc_enabled() -> Result<bool, String> {
    let path = data_dir()?.join("discord_rpc.json");
    if !path.exists() {
        return Ok(true); // Default: enabled
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;
    let val: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({"enabled": true}));
    Ok(val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true))
}

pub fn run() {
    // Default cleanup: 7 days. The frontend can call cleanup_clipboard with the user's setting.
    cleanup_old_images(7);

    // Read Discord RPC preference synchronously for startup
    let discord_enabled = {
        let path = data_dir().ok().map(|d| d.join("discord_rpc.json"));
        path.and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .and_then(|v| v.get("enabled").and_then(|e| e.as_bool()))
            .unwrap_or(true)
    };

    // Connect to Discord if enabled
    let discord_state = if discord_enabled {
        let mut client_opt = None;
        let mut ts = 0i64;
        let mut client = DiscordIpcClient::new(DISCORD_APP_ID);
        if client.connect().is_ok() {
            ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let _ = client.set_activity(
                activity::Activity::new()
                    .state("Idle")
                    .details("Using clauke")
                    .timestamps(activity::Timestamps::new().start(ts))
                    .assets(
                        activity::Assets::new()
                            .large_image("clauke_icon")
                            .large_text("Clauke - Claude Code Wrapper"),
                    ),
            );
            client_opt = Some(client);
        }
        DiscordRpcState {
            client: client_opt,
            enabled: true,
            start_timestamp: ts,
        }
    } else {
        DiscordRpcState {
            client: None,
            enabled: false,
            start_timestamp: 0,
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            tabs: Arc::new(Mutex::new(HashMap::new())),
            discord: Arc::new(Mutex::new(discord_state)),
        })
        .invoke_handler(tauri::generate_handler![send_prompt, stop_claude, steer_claude, save_clipboard_image, list_slash_commands, cleanup_clipboard, generate_title, list_agents, list_mcp_servers, add_mcp_server, remove_mcp_server, check_mcp_server, list_hooks, add_hook, remove_hook, storage_read, storage_write, storage_delete, get_cli_mode, list_directory, detect_editors, open_in_editor, check_claude_cli, read_file_contents, write_file_contents, toggle_discord_rpc, update_discord_rpc, get_discord_rpc_enabled])
        .run(tauri::generate_context!())
        .expect("error while running clauke");
}
