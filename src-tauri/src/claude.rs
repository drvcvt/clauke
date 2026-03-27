use serde_json::Value;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, Notify};

/// Handle to a running Claude CLI process — can be cloned and used to kill or steer it.
#[derive(Clone)]
pub struct ClaudeProcess {
    cancel: Arc<Notify>,
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
}

/// The actual running process (owns the Child).
pub struct ClaudeRunner {
    child: Child,
    cancel: Arc<Notify>,
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
}

impl ClaudeRunner {
    /// Spawn `claude` CLI with streaming JSON output.
    pub fn spawn(
        prompt: &str,
        cwd: Option<&str>,
        model: Option<&str>,
        resume: Option<&str>,
        images: &[String],
        skip_permissions: bool,
        allowed_tools: Option<&[String]>,
        system_prompt: Option<&str>,
        add_dirs: &[String],
        agent: Option<&str>,
        continue_last: bool,
        claude_path: Option<&str>,
    ) -> Result<Self, std::io::Error> {
        let mut cmd = Command::new(claude_path.unwrap_or("claude"));
        cmd.args([
            "--output-format",
            "stream-json",
            "--verbose",
        ]);
        if skip_permissions {
            cmd.arg("--dangerously-skip-permissions");
        } else if let Some(tools) = allowed_tools {
            if !tools.is_empty() {
                for tool in tools {
                    cmd.args(["--allowedTools", tool]);
                }
            }
        }
        if let Some(sp) = system_prompt {
            if !sp.is_empty() {
                cmd.args(["--append-system-prompt", sp]);
            }
        }
        if continue_last && resume.is_none() {
            cmd.arg("--continue");
        } else if let Some(session_id) = resume {
            cmd.args(["--resume", session_id]);
        }
        for dir in add_dirs {
            cmd.args(["--add-dir", dir]);
        }
        if let Some(a) = agent {
            cmd.args(["--agent", a]);
        }
        // Claude CLI has no --image flag. Instead, mention image paths in the
        // prompt so Claude can read them via its Read tool.
        let final_prompt = if images.is_empty() {
            prompt.to_string()
        } else {
            let refs: Vec<String> = images.iter().map(|p| format!("  {}", p)).collect();
            let img_section = format!(
                "[The user attached the following image file(s) — use Read to view them:\n{}\n]",
                refs.join("\n")
            );
            if prompt.is_empty() {
                format!("{}\nDescribe the attached image(s).", img_section)
            } else {
                format!("{}\n{}", img_section, prompt)
            }
        };
        // Stream-json I/O: prompt delivered via stdin, pipe stays open for steering.
        // -p is REQUIRED for --input-format and --output-format to take effect.
        // With --input-format stream-json, -p processes each JSON line immediately
        // (no EOF wait — that only applies to --input-format text).
        cmd.args(["-p", "--input-format", "stream-json"]);
        cmd.stdin(Stdio::piped());

        if let Some(m) = model {
            cmd.args(["--model", m]);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.kill_on_drop(true);

        // Prevent a console window from flashing on Windows
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn()?;
        let cancel = Arc::new(Notify::new());

        // Capture stdin and send the initial prompt as stream-json message.
        // The stream-json input format expects:
        //   {"type":"user","message":{"role":"user","content":"..."},"parent_tool_use_id":null,"session_id":null}
        let child_stdin = child.stdin.take();
        let stdin = Arc::new(Mutex::new(child_stdin));
        let stdin_clone = Arc::clone(&stdin);
        let prompt_json = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": final_prompt,
            },
            "parent_tool_use_id": null,
            "session_id": null,
        });
        let prompt_str = serde_json::to_string(&prompt_json)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        // Spawn a task to write the initial prompt without blocking spawn()
        tokio::spawn(async move {
            let mut guard = stdin_clone.lock().await;
            if let Some(ref mut w) = *guard {
                let _ = w.write_all(prompt_str.as_bytes()).await;
                let _ = w.write_all(b"\n").await;
                let _ = w.flush().await;
            }
        });

        Ok(Self { child, cancel, stdin })
    }

    /// Get a clonable handle that can kill or steer this process.
    pub fn handle(&self) -> ClaudeProcess {
        ClaudeProcess {
            cancel: Arc::clone(&self.cancel),
            stdin: Arc::clone(&self.stdin),
        }
    }

    /// Stream Claude events to the Tauri frontend, tagged with a tab ID.
    pub async fn stream_events(&mut self, app: &AppHandle, tab_id: &str) -> Result<(), String> {
        let stdout = self
            .child
            .stdout
            .take()
            .ok_or("Failed to capture stdout")?;
        let stderr = self
            .child
            .stderr
            .take()
            .ok_or("Failed to capture stderr")?;

        // ── CRITICAL: drain stderr in a background task ──────────────
        // If stderr's pipe buffer fills up (4-64 KB depending on OS), the
        // child process blocks on write(stderr), which also stalls stdout.
        // This causes a deadlock where we wait for stdout but the process
        // is blocked writing to stderr.  Draining it prevents that.
        let stderr_task = tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            let mut buf = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() && buf.len() < 8192 {
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(trimmed);
                }
            }
            buf
        });

        // ── read stdout (the actual stream-json events) ──────────────
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut was_cancelled = false;

        loop {
            tokio::select! {
                line = lines.next_line() => {
                    match line.map_err(|e| e.to_string())? {
                        Some(line) => {
                            let trimmed = line.trim();
                            if trimmed.is_empty() { continue; }

                            match serde_json::from_str::<Value>(trimmed) {
                                Ok(mut event) => {
                                    if let Some(obj) = event.as_object_mut() {
                                        obj.insert("tab_id".into(), Value::String(tab_id.to_string()));
                                    }
                                    app.emit("claude-event", &event)
                                        .map_err(|e| e.to_string())?;
                                }
                                Err(_) => {
                                    let raw = serde_json::json!({
                                        "type": "raw",
                                        "text": trimmed,
                                        "tab_id": tab_id,
                                    });
                                    app.emit("claude-event", &raw)
                                        .map_err(|e| e.to_string())?;
                                }
                            }
                        }
                        None => break, // EOF
                    }
                }
                _ = self.cancel.notified() => {
                    let _ = self.child.kill().await;
                    was_cancelled = true;
                    break;
                }
            }
        }

        // Wait for process to finish and collect exit status
        let status = self.child.wait().await.map_err(|e| e.to_string())?;
        let stderr_output = stderr_task.await.unwrap_or_else(|_| String::new());

        // Only report exit errors for non-cancelled processes — a user-initiated
        // stop always produces a non-zero exit code, which isn't an error.
        if !was_cancelled && !status.success() {
            let code = status.code().unwrap_or(-1);
            let mut text = format!("Claude exited with code {code}");
            if !stderr_output.is_empty() {
                text.push_str("\n\n");
                text.push_str(&stderr_output);
            }
            let ev = serde_json::json!({ "type": "error", "text": text, "tab_id": tab_id });
            let _ = app.emit("claude-event", &ev);
        }

        Ok(())
    }
}

impl ClaudeProcess {
    /// Returns true if both handles refer to the same spawned process.
    pub fn is_same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancel, &other.cancel)
    }

    /// Send a steering message to the running process via stdin.
    pub async fn steer(&self, message: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().await;
        if let Some(ref mut stdin) = *guard {
            let msg = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": message,
                },
                "parent_tool_use_id": null,
                "session_id": null,
            });
            let json_str = serde_json::to_string(&msg)
                .map_err(|e| format!("Failed to serialize steer message: {}", e))?;
            stdin
                .write_all(json_str.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin
                .write_all(b"\n")
                .await
                .map_err(|e| format!("Failed to write newline: {}", e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            Ok(())
        } else {
            Err("Process stdin not available".to_string())
        }
    }

    /// Kill the running process.
    /// Drops stdin first so any orphaned writer tasks unblock immediately,
    /// then signals the stream loop to break and kill the child.
    pub async fn kill(&self) {
        // Drop stdin so pending write tasks get a broken-pipe error and exit
        let _ = self.stdin.lock().await.take();
        self.cancel.notify_one();
    }
}
