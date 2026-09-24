use std::collections::HashMap;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use tauri::ipc::Channel;
use tauri::{Manager, RunEvent, State};
use tokio::sync::Notify;

const KEYRING_SERVICE: &str = "agent-client";
const KEYRING_USER: &str = "hermes-api-key";
const SSH_EXE: &str = r"C:\Windows\System32\OpenSSH\ssh.exe";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const LOCAL_PORT: u16 = 8642;
const ADMIN_TOKEN_HEADER: &str = "X-Hermes-Session-Token";

/// Local Hermes' settings backend (`hermes serve`), with the token it was started with.
struct AdminBackend {
  /// None when adopting one this app started earlier and left running (a crash or forced close).
  child: Option<Child>,
  port: u16,
  token: String,
}

// Where the settings backend this app runs listens, and its access token, kept across launches:
// Hermes allows one such backend per machine, so a leftover one is reused rather than blocking us.
const ADMIN_KEY_USER: &str = "hermes-settings-backend";

#[derive(Default)]
struct AppState {
  tunnel: Mutex<Option<Child>>,
  runs: Mutex<HashMap<String, Arc<Notify>>>,
  admin: tokio::sync::Mutex<Option<AdminBackend>>,
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
  use std::os::windows::process::CommandExt;
  command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

/// Hermes' own home: HERMES_HOME, else the Windows installer default, else ~/.hermes.
fn hermes_home() -> Option<PathBuf> {
  if let Some(home) = std::env::var_os("HERMES_HOME") {
    return Some(PathBuf::from(home));
  }
  let local = std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("hermes"));
  if let Some(local) = local.filter(|dir| dir.join(".env").exists()) {
    return Some(local);
  }
  std::env::var_os("USERPROFILE").map(|dir| PathBuf::from(dir).join(".hermes"))
}

fn local_env_value(name: &str) -> Option<String> {
  let text = std::fs::read_to_string(hermes_home()?.join(".env")).ok()?;
  text
    .lines()
    .filter_map(|line| line.trim().strip_prefix(name)?.strip_prefix('='))
    .map(|value| value.trim().trim_matches('"').to_string())
    .filter(|value| !value.is_empty())
    .last()
}

fn key_entry() -> Result<keyring::Entry, String> {
  keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| "keyring".to_string())
}

/// Local mode uses the key local Hermes already holds; remote mode uses Credential Manager.
fn read_api_key(mode: &str) -> Result<String, String> {
  if mode == "local" {
    return local_env_value("API_SERVER_KEY").ok_or_else(|| "local_api_off".to_string());
  }
  match key_entry()?.get_password() {
    Ok(key) => Ok(key),
    Err(keyring::Error::NoEntry) => Err("no_key".into()),
    Err(_) => Err("keyring".into()),
  }
}

fn port_open(port: u16) -> bool {
  let address = SocketAddr::from(([127, 0, 0, 1], port));
  TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

fn http_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(5))
    .build()
    .map_err(|_| "unreachable".to_string())
}

fn status_error(status: reqwest::StatusCode) -> String {
  match status.as_u16() {
    401 | 403 => "auth".into(),
    _ => "server".into(),
  }
}

#[tauri::command]
fn has_api_key() -> bool {
  read_api_key("remote").is_ok()
}

#[tauri::command]
fn save_api_key(key: String) -> Result<(), String> {
  let key = key.trim();
  if key.is_empty() {
    return Err("empty_key".into());
  }
  key_entry()?.set_password(key).map_err(|_| "keyring".to_string())
}

#[tauri::command]
fn delete_api_key() -> Result<(), String> {
  match key_entry()?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(_) => Err("keyring".into()),
  }
}

/// Turns on local Hermes' API server (loopback only) and restarts its gateway.
#[tauri::command]
async fn enable_local_api() -> Result<(), String> {
  let home = hermes_home().ok_or_else(|| "local_missing".to_string())?;
  let hermes = home.join("bin").join("hermes.cmd");
  if !hermes.exists() {
    return Err("local_missing".into());
  }
  if local_env_value("API_SERVER_KEY").is_none() {
    let key = random_key(48);
    let env_path = home.join(".env");
    let mut text = std::fs::read_to_string(&env_path).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
      text.push('\n');
    }
    text.push_str(&format!(
      "\n# Crema local connection\nAPI_SERVER_KEY={key}\nAPI_SERVER_HOST=127.0.0.1\nAPI_SERVER_PORT={LOCAL_PORT}\n"
    ));
    std::fs::write(&env_path, text).map_err(|_| "local_config".to_string())?;
  }
  let mut command = Command::new("cmd");
  command.args(["/C"]).arg(&hermes).args(["gateway", "restart"]);
  hide_window(&mut command);
  let status = tokio::task::spawn_blocking(move || command.status())
    .await
    .map_err(|_| "local_restart".to_string())?
    .map_err(|_| "local_restart".to_string())?;
  if !status.success() {
    return Err("local_restart".into());
  }
  for _ in 0..180 {
    if port_open(LOCAL_PORT) {
      return Ok(());
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
  }
  Err("local_restart".into())
}

fn random_key(len: usize) -> String {
  let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  (0..len).map(|_| alphabet[(rand_u32() as usize) % alphabet.len()] as char).collect()
}

fn rand_u32() -> u32 {
  // Random enough for a loopback-only key: OS-seeded hasher state per call.
  use std::hash::{BuildHasher, Hasher};
  let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
  hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
  hasher.finish() as u32
}

/// Opens `ssh -L` to the Hermes host unless the local port already answers.
#[tauri::command]
async fn ensure_tunnel(
  state: State<'_, AppState>,
  ssh_target: String,
  remote: String,
  local_port: u16,
) -> Result<(), String> {
  if port_open(local_port) {
    return Ok(());
  }
  {
    let mut tunnel = state.tunnel.lock().unwrap();
    let running = matches!(tunnel.as_mut().map(|child| child.try_wait()), Some(Ok(None)));
    if !running {
      let mut command = Command::new(SSH_EXE);
      command.args([
        "-N",
        "-o",
        "BatchMode=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=30",
        "-L",
        &format!("127.0.0.1:{local_port}:{remote}"),
        &ssh_target,
      ]);
      hide_window(&mut command);
      *tunnel = Some(command.spawn().map_err(|_| "tunnel".to_string())?);
    }
  }
  for _ in 0..40 {
    tokio::time::sleep(Duration::from_millis(250)).await;
    if port_open(local_port) {
      return Ok(());
    }
    let mut tunnel = state.tunnel.lock().unwrap();
    if matches!(tunnel.as_mut().map(|child| child.try_wait()), Some(Ok(Some(_)))) {
      *tunnel = None;
      return Err("tunnel".into());
    }
  }
  Err("tunnel".into())
}

/// Confirms Hermes answers and accepts the key without running the agent.
#[tauri::command]
async fn check_connection(base_url: String, mode: String) -> Result<(), String> {
  let key = read_api_key(&mode)?;
  let client = http_client()?;
  client
    .get(format!("{base_url}/health"))
    .send()
    .await
    .map_err(|_| "unreachable".to_string())?;
  let response = client
    .get(format!("{base_url}/v1/models"))
    .bearer_auth(key)
    .send()
    .await
    .map_err(|_| "unreachable".to_string())?;
  if !response.status().is_success() {
    return Err(status_error(response.status()));
  }
  Ok(())
}

/// Hermes' own model-picker inventory (providers, their models, current default).
#[tauri::command]
async fn model_options(base_url: String, mode: String) -> Result<serde_json::Value, String> {
  let key = read_api_key(&mode)?;
  let response = http_client()?
    .get(format!("{base_url}/api/model/options"))
    .bearer_auth(key)
    .send()
    .await
    .map_err(|_| "unreachable".to_string())?;
  if !response.status().is_success() {
    return Err(status_error(response.status()));
  }
  response.json().await.map_err(|_| "server".to_string())
}

/// Runs one turn as a Hermes run (the path that can ask the user to approve a flagged command)
/// and streams its events to the page; the API key never leaves this process.
#[tauri::command]
async fn chat_stream(
  state: State<'_, AppState>,
  base_url: String,
  mode: String,
  run_id: String,
  session_id: String,
  session_key: String,
  content: serde_json::Value,
  model: String,
  provider: String,
  system: String,
  model_options: serde_json::Value,
  session_title: String,
  on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
  let key = read_api_key(&mode)?;
  let cancel = Arc::new(Notify::new());
  state.runs.lock().unwrap().insert(run_id.clone(), cancel.clone());

  // `input` as a one-message list: a bare list would be read as messages, not as text/image parts.
  let mut body = serde_json::json!({
    "input": [{ "role": "user", "content": content }],
    "session_id": session_id,
  });
  if !system.is_empty() {
    body["instructions"] = system.into();
  }
  if !model.is_empty() {
    body["model"] = model.into();
  }
  if !provider.is_empty() {
    body["provider"] = provider.into();
  }
  if model_options.as_object().is_some_and(|options| !options.is_empty()) {
    body["model_options"] = model_options;
  }

  let client = http_client()?;
  let result = async {
    // A throwaway session named up front: Hermes skips auto-titling a named session, and that
    // titling (usage accounting) would otherwise recreate the session right after we delete it.
    if !session_title.is_empty() {
      let created = client
        .post(format!("{base_url}/api/sessions"))
        .bearer_auth(&key)
        .json(&serde_json::json!({ "id": session_id }))
        .send()
        .await
        .map_err(|_| "unreachable".to_string())?;
      if !created.status().is_success() {
        return Err(status_error(created.status()));
      }
      let named = client
        .patch(format!("{base_url}/api/sessions/{session_id}"))
        .bearer_auth(&key)
        .json(&serde_json::json!({ "title": session_title }))
        .send()
        .await
        .map_err(|_| "unreachable".to_string())?;
      if !named.status().is_success() {
        return Err(status_error(named.status()));
      }
    }

    let response = client
      .post(format!("{base_url}/v1/runs"))
      .bearer_auth(&key)
      .header("X-Hermes-Session-Key", session_key)
      .json(&body)
      .send()
      .await
      .map_err(|_| "unreachable".to_string())?;
    if !response.status().is_success() {
      return Err(status_error(response.status()));
    }
    let accepted: serde_json::Value = response.json().await.map_err(|_| "server".to_string())?;
    let hermes_run = accepted["run_id"].as_str().ok_or_else(|| "server".to_string())?.to_string();

    let response = client
      .get(format!("{base_url}/v1/runs/{hermes_run}/events"))
      .bearer_auth(&key)
      .header("Accept", "text/event-stream")
      .send()
      .await
      .map_err(|_| "unreachable".to_string())?;
    if !response.status().is_success() {
      return Err(status_error(response.status()));
    }

    let mut stream = response.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    loop {
      let chunk = tokio::select! {
        _ = cancel.notified() => {
          // Stops the agent itself (and releases a pending approval), not just this stream.
          let _ = client
            .post(format!("{base_url}/v1/runs/{hermes_run}/stop"))
            .bearer_auth(&key)
            .send()
            .await;
          return Err("cancelled".to_string());
        }
        chunk = stream.next() => chunk,
      };
      let Some(chunk) = chunk else { break };
      pending.extend_from_slice(&chunk.map_err(|_| "interrupted".to_string())?);
      // Forward only complete UTF-8 so Korean characters never split across events.
      let valid = match std::str::from_utf8(&pending) {
        Ok(text) => text.len(),
        Err(error) => error.valid_up_to(),
      };
      if valid > 0 {
        let text = String::from_utf8(pending.drain(..valid).collect()).unwrap();
        on_event.send(serde_json::json!({ "data": text })).map_err(|_| "cancelled".to_string())?;
      }
    }
    on_event.send(serde_json::json!({ "end": true })).map_err(|_| "cancelled".to_string())
  }
  .await;

  state.runs.lock().unwrap().remove(&run_id);
  result
}

/// Answers a Hermes run's approval request: `choice` is "once" (allow) or "deny".
#[tauri::command]
async fn run_approval(
  base_url: String,
  mode: String,
  hermes_run: String,
  request_id: Option<String>,
  choice: String,
) -> Result<(), String> {
  let key = read_api_key(&mode)?;
  let mut body = serde_json::json!({ "choice": choice });
  if let Some(request_id) = request_id {
    body["request_id"] = request_id.into();
  }
  let response = http_client()?
    .post(format!("{base_url}/v1/runs/{hermes_run}/approval"))
    .bearer_auth(key)
    .json(&body)
    .send()
    .await
    .map_err(|_| "unreachable".to_string())?;
  if !response.status().is_success() {
    return Err(status_error(response.status()));
  }
  Ok(())
}

/// Per Hermes channel, from local Hermes' auth.json: `kind` ("oauth" = subscription, "api_key" …)
/// and `relogin` (a login error newer than the last successful refresh, so it can't be used now).
/// Only these metadata fields are read; tokens never leave the file.
#[tauri::command]
fn auth_kinds(mode: String) -> serde_json::Value {
  let mut channels = serde_json::Map::new();
  if mode != "local" {
    return channels.into();
  }
  let Some(text) = hermes_home().and_then(|home| std::fs::read_to_string(home.join("auth.json")).ok()) else {
    return channels.into();
  };
  let Ok(auth) = serde_json::from_str::<serde_json::Value>(&text) else {
    return channels.into();
  };
  if let Some(pool) = auth.get("credential_pool").and_then(|pool| pool.as_object()) {
    for (channel, entries) in pool {
      if let Some(kind) = entries.get(0).and_then(|entry| entry.get("auth_type")).and_then(|kind| kind.as_str()) {
        channels.insert(channel.clone(), serde_json::json!({ "kind": kind, "relogin": false }));
      }
    }
  }
  if let Some(providers) = auth.get("providers").and_then(|providers| providers.as_object()) {
    for (channel, state) in providers {
      let error = &state["last_auth_error"];
      if error["relogin_required"].as_bool() != Some(true) {
        continue;
      }
      // ISO timestamps compare correctly as strings; a later refresh means the error was resolved.
      let failed_at = error["at"].as_str().unwrap_or("");
      let refreshed_at = state["last_refresh"].as_str().unwrap_or("");
      if refreshed_at.is_empty() || refreshed_at < failed_at {
        let entry = channels.entry(channel.clone()).or_insert_with(|| serde_json::json!({ "kind": "" }));
        entry["relogin"] = true.into();
      }
    }
  }
  channels.into()
}

fn saved_admin() -> Option<(u16, String)> {
  let saved = keyring::Entry::new(KEYRING_SERVICE, ADMIN_KEY_USER).ok()?.get_password().ok()?;
  let (port, token) = saved.split_once(' ')?;
  Some((port.parse().ok()?, token.to_string()))
}

fn save_admin(port: u16, token: &str) {
  if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, ADMIN_KEY_USER) {
    let _ = entry.set_password(&format!("{port} {token}"));
  }
}

async fn admin_ready(client: &reqwest::Client, port: u16, token: &str) -> bool {
  client
    .get(format!("http://127.0.0.1:{port}/api/providers/oauth"))
    .header(ADMIN_TOKEN_HEADER, token)
    .send()
    .await
    .map(|response| response.status().is_success())
    .unwrap_or(false)
}

/// Local Hermes' settings backend — `hermes serve`, the same one Hermes Desktop runs — so sign-ins
/// and API keys go through Hermes' own code instead of editing its files. Started on first use,
/// or the one this app left running last time is taken back.
async fn admin_backend(state: &AppState) -> Result<(u16, String), String> {
  let mut admin = state.admin.lock().await;
  let client = http_client()?;
  if let Some(backend) = admin.as_mut() {
    let alive = match backend.child.as_mut() {
      Some(child) => matches!(child.try_wait(), Ok(None)),
      None => admin_ready(&client, backend.port, &backend.token).await,
    };
    if alive {
      return Ok((backend.port, backend.token.clone()));
    }
    *admin = None;
  }
  if let Some((port, token)) = saved_admin() {
    if admin_ready(&client, port, &token).await {
      *admin = Some(AdminBackend { child: None, port, token: token.clone() });
      return Ok((port, token));
    }
  }
  let home = hermes_home().ok_or_else(|| "local_missing".to_string())?;
  let python = home.join("hermes-agent").join("venv").join("Scripts").join("python.exe");
  if !python.exists() {
    return Err("local_missing".into());
  }
  let port = TcpListener::bind("127.0.0.1:0")
    .and_then(|listener| listener.local_addr())
    .map_err(|_| "admin_start".to_string())?
    .port();
  let token = saved_admin().map(|(_, token)| token).unwrap_or_else(|| random_key(48));
  save_admin(port, &token);
  // Its messages go to a file so a refusal to start can be told apart from a crash.
  let log_path = std::env::temp_dir().join("agent-client-hermes-serve.log");
  let log = std::fs::File::create(&log_path).map_err(|_| "admin_start".to_string())?;
  let mut command = Command::new(&python);
  command
    .args(["-m", "hermes_cli.main", "serve", "--port", &port.to_string()])
    .env("HERMES_DASHBOARD_SESSION_TOKEN", &token)
    .stdout(log.try_clone().map_err(|_| "admin_start".to_string())?)
    .stderr(log);
  hide_window(&mut command);
  let child = command.spawn().map_err(|_| "admin_start".to_string())?;
  *admin = Some(AdminBackend { child: Some(child), port, token: token.clone() });
  // A cold start takes about 20 seconds.
  for _ in 0..180 {
    if admin_ready(&client, port, &token).await {
      return Ok((port, token));
    }
    let exited = admin
      .as_mut()
      .and_then(|backend| backend.child.as_mut())
      .map(|child| !matches!(child.try_wait(), Ok(None)))
      .unwrap_or(true);
    if exited {
      *admin = None;
      // Hermes allows one settings backend per machine; another program (e.g. its dashboard) holds it.
      let said = std::fs::read_to_string(&log_path).unwrap_or_default();
      return Err(if said.contains("already served") { "admin_busy" } else { "admin_start" }.into());
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
  }
  Err("admin_start".into())
}

/// PID listening on a local port (from `netstat`), for a taken-back backend we hold no handle to.
fn listening_pid(port: u16) -> Option<u32> {
  let mut command = Command::new("netstat");
  command.args(["-ano", "-p", "TCP"]);
  hide_window(&mut command);
  let output = String::from_utf8_lossy(&command.output().ok()?.stdout).into_owned();
  let address = format!("127.0.0.1:{port}");
  output
    .lines()
    .map(|line| line.split_whitespace().collect::<Vec<_>>())
    .find(|cols| cols.len() >= 5 && cols[1] == address && cols[3] == "LISTENING")
    .and_then(|cols| cols[4].parse().ok())
}

fn stop_admin_backend(state: &AppState) {
  if let Ok(mut admin) = state.admin.try_lock() {
    if let Some(backend) = admin.take() {
      let pid = match &backend.child {
        Some(child) => Some(child.id()),
        None => listening_pid(backend.port),
      };
      if let Some(pid) = pid {
        // The whole tree: the server may have started workers of its own.
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        hide_window(&mut command);
        let _ = command.status();
      }
    }
  }
}

/// One request to local Hermes' settings API (`/api/...`): provider sign-ins, API keys.
#[tauri::command]
async fn hermes_admin(
  state: State<'_, AppState>,
  method: String,
  path: String,
  body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
  if !path.starts_with("/api/") {
    return Err("server".into());
  }
  let (port, token) = admin_backend(&state).await?;
  let client = http_client()?;
  let url = format!("http://127.0.0.1:{port}{path}");
  let request = match method.as_str() {
    "GET" => client.get(url),
    "POST" => client.post(url),
    "PUT" => client.put(url),
    _ => return Err("server".into()),
  };
  let request = request.header(ADMIN_TOKEN_HEADER, token).timeout(Duration::from_secs(60));
  let request = match body {
    Some(body) => request.json(&body),
    None => request,
  };
  let response = request.send().await.map_err(|_| "unreachable".to_string())?;
  if !response.status().is_success() {
    return Err("server".into());
  }
  response.json().await.map_err(|_| "server".to_string())
}

/// Opens a console running a Provider's own sign-in command — the ones Hermes leaves to a terminal
/// (e.g. `hermes auth add anthropic`, `claude setup-token`, `copilot login`).
#[tauri::command]
fn open_login_terminal(command: String) -> Result<(), String> {
  let mut parts: Vec<String> = command.split_whitespace().map(str::to_string).collect();
  let safe = parts.iter().all(|part| part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
  if !safe || !matches!(parts.first().map(String::as_str), Some("hermes" | "claude" | "copilot")) {
    return Err("server".into());
  }
  if parts[0] == "hermes" {
    let hermes = hermes_home().ok_or_else(|| "local_missing".to_string())?.join("bin").join("hermes.cmd");
    parts[0] = hermes.to_string_lossy().into_owned();
  }
  Command::new("cmd")
    .args(["/C", "start", "Hermes 로그인", "cmd", "/K"])
    .args(&parts)
    .spawn()
    .map(|_| ())
    .map_err(|_| "server".to_string())
}

const ATTACHMENT_LIMIT: u64 = 20 * 1024 * 1024;
// Folders never worth offering as @-mentions.
const SKIPPED_DIRS: [&str; 9] = [".git", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__", ".next"];

/// A picked image's bytes, for an inline image part (Hermes decides native vs described per model).
#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
  let size = std::fs::metadata(&path).map_err(|_| "file_read".to_string())?.len();
  if size > ATTACHMENT_LIMIT {
    return Err("file_too_large".into());
  }
  std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|_| "file_read".to_string())
}

/// Copies an attached file into local Hermes' document cache — where its own chat channels put
/// received documents — and returns the path the agent should read.
#[tauri::command]
fn stage_document(path: String) -> Result<String, String> {
  let source = PathBuf::from(&path);
  let name = source.file_name().ok_or_else(|| "file_read".to_string())?.to_string_lossy().into_owned();
  let folder = hermes_home().ok_or_else(|| "local_missing".to_string())?.join("cache").join("documents");
  std::fs::create_dir_all(&folder).map_err(|_| "file_read".to_string())?;
  let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
  let target = folder.join(format!("{stamp}_{name}"));
  std::fs::copy(&source, &target).map_err(|_| "file_read".to_string())?;
  Ok(target.to_string_lossy().into_owned())
}

fn git(path: &str, args: &[&str]) -> Option<String> {
  let mut command = Command::new("git");
  command.arg("-C").arg(path).args(args);
  hide_window(&mut command);
  let output = command.output().ok()?;
  output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// The project folder's branch, its local branches, and whether it has uncommitted changes;
/// null when it is not a Git work tree.
#[tauri::command]
async fn git_info(path: String) -> Option<serde_json::Value> {
  tokio::task::spawn_blocking(move || {
    let branch = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branches: Vec<String> = git(&path, &["branch", "--format=%(refname:short)"])
      .unwrap_or_default()
      .lines()
      .map(str::to_string)
      .collect();
    let dirty = !git(&path, &["status", "--porcelain"]).unwrap_or_default().is_empty();
    Some(serde_json::json!({ "branch": branch, "branches": branches, "dirty": dirty }))
  })
  .await
  .ok()
  .flatten()
}

/// Switches branch only on a clean work tree, so no uncommitted change is carried or lost.
#[tauri::command]
async fn git_switch(path: String, branch: String) -> Result<(), String> {
  if branch.starts_with('-') {
    return Err("git_switch".into());
  }
  tokio::task::spawn_blocking(move || {
    if !git(&path, &["status", "--porcelain"]).ok_or_else(|| "git_switch".to_string())?.is_empty() {
      return Err("git_dirty".to_string());
    }
    git(&path, &["switch", &branch]).map(|_| ()).ok_or_else(|| "git_switch".to_string())
  })
  .await
  .map_err(|_| "git_switch".to_string())?
}

/// Creates a branch from the current one and switches to it; uncommitted changes come along.
#[tauri::command]
async fn git_create_branch(path: String, name: String) -> Result<(), String> {
  tokio::task::spawn_blocking(move || {
    git(&path, &["check-ref-format", "--branch", &name]).ok_or_else(|| "git_branch_name".to_string())?;
    git(&path, &["switch", "-c", &name]).map(|_| ()).ok_or_else(|| "git_switch".to_string())
  })
  .await
  .map_err(|_| "git_switch".to_string())?
}

/// Project files matching `query` (case-insensitive) for @-mentions: file-name matches first, then
/// path matches, shorter paths first. Links are skipped (they may loop or leave the project).
#[tauri::command]
async fn list_project_files(path: String, query: String) -> Vec<String> {
  tokio::task::spawn_blocking(move || {
    let root = PathBuf::from(&path);
    let query = query.to_lowercase();
    let mut found: Vec<(bool, String)> = Vec::new();
    let mut stack = vec![root.clone()];
    let mut seen = 0;
    'walk: while let Some(dir) = stack.pop() {
      let Ok(entries) = std::fs::read_dir(&dir) else { continue };
      for entry in entries.flatten() {
        seen += 1;
        if seen > 20_000 || found.len() >= 300 {
          break 'walk;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
          continue;
        }
        if kind.is_dir() {
          if !SKIPPED_DIRS.contains(&name.as_str()) {
            stack.push(entry.path());
          }
          continue;
        }
        let relative = entry.path().strip_prefix(&root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or(name.clone());
        if relative.to_lowercase().contains(&query) {
          found.push((name.to_lowercase().contains(&query), relative));
        }
      }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.len().cmp(&b.1.len())));
    found.into_iter().take(30).map(|(_, relative)| relative).collect()
  })
  .await
  .unwrap_or_default()
}

/// Hermes version plus stored stats for the given sessions (missing ones are skipped).
#[tauri::command]
async fn hermes_info(base_url: String, mode: String, session_ids: Vec<String>) -> Result<serde_json::Value, String> {
  let key = read_api_key(&mode)?;
  let client = http_client()?;
  let health: serde_json::Value = client
    .get(format!("{base_url}/health"))
    .send()
    .await
    .map_err(|_| "unreachable".to_string())?
    .json()
    .await
    .unwrap_or_default();
  let mut sessions = Vec::new();
  for id in session_ids {
    let response = client
      .get(format!("{base_url}/api/sessions/{id}"))
      .bearer_auth(&key)
      .send()
      .await
      .map_err(|_| "unreachable".to_string())?;
    if response.status().is_success() {
      let payload: serde_json::Value = response.json().await.unwrap_or_default();
      sessions.push(payload["session"].clone());
    }
  }
  Ok(serde_json::json!({ "health": health, "sessions": sessions }))
}

/// Deletes a Hermes session (transcript); one that never reached Hermes counts as deleted.
#[tauri::command]
async fn delete_session(base_url: String, mode: String, session_id: String) -> Result<(), String> {
  let key = read_api_key(&mode)?;
  let response = http_client()?
    .delete(format!("{base_url}/api/sessions/{session_id}"))
    .bearer_auth(key)
    .send()
    .await
    .map_err(|_| "unreachable".to_string())?;
  match response.status().as_u16() {
    200..=299 | 404 => Ok(()),
    _ => Err(status_error(response.status())),
  }
}

#[tauri::command]
fn cancel_chat(state: State<'_, AppState>, run_id: String) {
  if let Some(cancel) = state.runs.lock().unwrap().get(&run_id) {
    cancel.notify_one();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // A second launch focuses the running window: two windows would overwrite each other's chats.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      has_api_key,
      save_api_key,
      delete_api_key,
      enable_local_api,
      ensure_tunnel,
      check_connection,
      model_options,
      chat_stream,
      run_approval,
      delete_session,
      hermes_info,
      auth_kinds,
      hermes_admin,
      open_login_terminal,
      read_file,
      stage_document,
      git_info,
      git_switch,
      git_create_branch,
      list_project_files,
      cancel_chat
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let RunEvent::Exit = event {
        if let Some(mut child) = app.state::<AppState>().tunnel.lock().unwrap().take() {
          let _ = child.kill();
        }
        stop_admin_backend(&app.state::<AppState>());
      }
    });
}

