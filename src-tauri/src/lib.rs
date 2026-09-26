use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Notify;

const KEYRING_SERVICE: &str = "agent-client";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SETTINGS_TOKEN_HEADER: &str = "X-Hermes-Session-Token";

/// Crema's engine (bundled by scripts/build-engine.ps1): started on first use, ended with the app.
struct Engine {
  child: Child,
  /// Base URLs of its run API and settings API, and the token both take.
  api: String,
  settings: String,
  token: String,
}

#[derive(Default)]
struct AppState {
  runs: Mutex<HashMap<String, Arc<Notify>>>,
  engine: tokio::sync::Mutex<Option<Engine>>,
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
  use std::os::windows::process::CommandExt;
  command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

/// Ends the engine (and every process it started) when Crema ends, even if Crema crashes: the job
/// closes with Crema's last handle to it.
#[cfg(windows)]
fn tie_to_app(child: &Child) {
  use std::os::windows::io::AsRawHandle;
  use windows_sys::Win32::System::JobObjects::*;
  unsafe {
    let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
    if job.is_null() {
      return;
    }
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformation,
      &limits as *const _ as *const std::ffi::c_void,
      std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
    );
    AssignProcessToJobObject(job, child.as_raw_handle() as _);
  }
}

#[cfg(not(windows))]
fn tie_to_app(_child: &Child) {}

/// The engine's data (sessions, sign-ins, keys, attachments): Crema's own, never a Hermes install's.
fn engine_home(app: &AppHandle) -> Result<PathBuf, String> {
  app.path().app_local_data_dir().map(|dir| dir.join("engine")).map_err(|_| "engine_start".to_string())
}

/// The running engine's run API, settings API and token, starting the engine when it is not running.
async fn engine(app: &AppHandle) -> Result<(String, String, String), String> {
  let state = app.state::<AppState>();
  let mut engine = state.engine.lock().await;
  if let Some(running) = engine.as_mut() {
    if matches!(running.child.try_wait(), Ok(None)) {
      return Ok((running.api.clone(), running.settings.clone(), running.token.clone()));
    }
    *engine = None;
  }
  let bundle = app.path().resource_dir().map_err(|_| "engine_start".to_string())?.join("engine");
  let home = engine_home(app)?;
  std::fs::create_dir_all(&home).map_err(|_| "engine_start".to_string())?;
  let token = random_token()?;
  // Its messages go to a file, so a failed start can be looked into.
  let log = std::fs::File::create(home.join("engine.log")).map_err(|_| "engine_start".to_string())?;
  let mut command = Command::new(bundle.join("python").join("python.exe"));
  command
    .arg(bundle.join("src").join("crema_engine.py"))
    .env("HERMES_HOME", &home)
    .env("HERMES_DASHBOARD_SESSION_TOKEN", &token)
    .env("PYTHONUTF8", "1")
    .env_remove("PYTHONHOME")
    .env_remove("PYTHONPATH")
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(log);
  if let Some(profile) = std::env::var_os("USERPROFILE") {
    command.current_dir(profile);
  }
  hide_window(&mut command);
  let mut child = command.spawn().map_err(|_| "engine_start".to_string())?;
  tie_to_app(&child);

  // Its first line is {"api": port, "settings": port}; the rest of its output is read and dropped
  // so a later print never meets a closed pipe.
  let stdout = child.stdout.take().ok_or_else(|| "engine_start".to_string())?;
  let (ready, first_line) = tokio::sync::oneshot::channel();
  std::thread::spawn(move || {
    use std::io::BufRead;
    let mut lines = std::io::BufReader::new(stdout).lines();
    let _ = ready.send(lines.next().and_then(Result::ok).unwrap_or_default());
    for _ in lines {}
  });
  // A first start on a new PC takes longest (Python compiles the engine once).
  let line = tokio::time::timeout(Duration::from_secs(120), first_line).await.ok().and_then(Result::ok).unwrap_or_default();
  let ports: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
  let (Some(api), Some(settings)) = (ports["api"].as_u64(), ports["settings"].as_u64()) else {
    let _ = child.kill();
    return Err("engine_start".into());
  };
  let running = Engine {
    child,
    api: format!("http://127.0.0.1:{api}"),
    settings: format!("http://127.0.0.1:{settings}"),
    token,
  };
  let answer = (running.api.clone(), running.settings.clone(), running.token.clone());
  *engine = Some(running);
  Ok(answer)
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

// Crema account (crema-agent.site): signed in once with Google in the browser, then kept here.
const ACCOUNT_SITE: &str = "https://crema-agent.site";
const ACCOUNT_KEY_USER: &str = "crema-account";

fn account_entry() -> Result<keyring::Entry, String> {
  keyring::Entry::new(KEYRING_SERVICE, ACCOUNT_KEY_USER).map_err(|_| "keyring".to_string())
}

fn random_token() -> Result<String, String> {
  use base64::Engine;
  let mut bytes = [0u8; 32];
  getrandom::fill(&mut bytes).map_err(|_| "sign_in".to_string())?;
  Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_challenge(verifier: &str) -> String {
  use base64::Engine;
  use sha2::Digest;
  base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()))
}

/// `code` from the site's return request `GET /callback?code=…&state=…`, when `state` is ours.
fn callback_code(request_line: &str, state: &str) -> Option<String> {
  let target = request_line.strip_prefix("GET ")?.split(' ').next()?;
  let query = target.strip_prefix("/callback?")?;
  let mut code = None;
  let mut state_ok = false;
  for pair in query.split('&') {
    match pair.split_once('=') {
      Some(("code", value)) if !value.is_empty() => code = Some(value.to_string()),
      Some(("state", value)) => state_ok = value == state,
      _ => {}
    }
  }
  code.filter(|_| state_ok)
}

/// Waits (up to 5 minutes) for the browser to come back to 127.0.0.1 with the one-time code.
fn wait_for_callback(listener: TcpListener, state: String) -> Result<String, String> {
  use std::io::{BufRead, BufReader, Write};
  listener.set_nonblocking(true).map_err(|_| "sign_in".to_string())?;
  let deadline = std::time::Instant::now() + Duration::from_secs(300);
  while std::time::Instant::now() < deadline {
    let (stream, _) = match listener.accept() {
      Ok(connection) => connection,
      Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
        std::thread::sleep(Duration::from_millis(200));
        continue;
      }
      Err(_) => return Err("sign_in".into()),
    };
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    let mut reader = BufReader::new(&stream);
    if reader.read_line(&mut line).is_err() {
      continue;
    }
    let code = callback_code(line.trim_end(), &state);
    let page = if code.is_some() {
      "로그인되었습니다. 이 창을 닫고 Crema로 돌아가 주세요."
    } else {
      "Crema 로그인 요청이 아닙니다."
    };
    let body = format!("<!doctype html><meta charset=utf-8><title>Crema</title><p style=\"font-family:sans-serif;margin:3em\">{page}</p>");
    let _ = (&stream).write_all(
      format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes(),
    );
    if let Some(code) = code {
      return Ok(code);
    }
  }
  Err("sign_in_timeout".into())
}

/// Signs this app in to Crema: browser → crema-agent.site → Google → back here (RFC 8252 loopback + PKCE).
#[tauri::command]
async fn sign_in(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
  use tauri_plugin_opener::OpenerExt;
  let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "sign_in".to_string())?;
  let port = listener.local_addr().map_err(|_| "sign_in".to_string())?.port();
  let state = random_token()?;
  let verifier = random_token()?;
  let url = format!(
    "{ACCOUNT_SITE}/app/login/?port={port}&state={state}&challenge={}",
    pkce_challenge(&verifier)
  );
  app.opener().open_url(url, None::<&str>).map_err(|_| "sign_in".to_string())?;
  let code = tokio::task::spawn_blocking(move || wait_for_callback(listener, state))
    .await
    .map_err(|_| "sign_in".to_string())??;
  // Back from the browser: bring Crema forward instead of leaving the user on the browser tab.
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
  let response = http_client()?
    .post(format!("{ACCOUNT_SITE}/api/app/token"))
    .json(&serde_json::json!({ "code": code, "verifier": verifier }))
    .send()
    .await
    .map_err(|_| "account_unreachable".to_string())?;
  if !response.status().is_success() {
    return Err("sign_in".into());
  }
  let body: serde_json::Value = response.json().await.map_err(|_| "sign_in".to_string())?;
  let token = body["token"].as_str().ok_or_else(|| "sign_in".to_string())?;
  account_entry()?.set_password(token).map_err(|_| "keyring".to_string())?;
  Ok(serde_json::json!({ "email": body["email"], "name": body["name"] }))
}

/// "signed_out" without a saved sign-in (or once the site revoked it); "offline" when the site
/// cannot be reached, so the app keeps working; otherwise the account.
#[tauri::command]
async fn account_status() -> Result<serde_json::Value, String> {
  let token = match account_entry()?.get_password() {
    Ok(token) => token,
    Err(keyring::Error::NoEntry) => return Ok(serde_json::json!({ "state": "signed_out" })),
    Err(_) => return Err("keyring".into()),
  };
  let response = match http_client()?.get(format!("{ACCOUNT_SITE}/api/me")).bearer_auth(&token).timeout(Duration::from_secs(8)).send().await {
    Ok(response) => response,
    Err(_) => return Ok(serde_json::json!({ "state": "offline" })),
  };
  match response.status().as_u16() {
    200 => {
      let me: serde_json::Value = response.json().await.unwrap_or_default();
      Ok(serde_json::json!({ "state": "signed_in", "email": me["email"], "name": me["name"] }))
    }
    401 => {
      let _ = account_entry()?.delete_credential();
      Ok(serde_json::json!({ "state": "signed_out" }))
    }
    _ => Ok(serde_json::json!({ "state": "offline" })),
  }
}

#[tauri::command]
async fn sign_out() -> Result<(), String> {
  if let Ok(token) = account_entry()?.get_password() {
    let _ = http_client()?.post(format!("{ACCOUNT_SITE}/api/app/logout")).bearer_auth(&token).send().await;
  }
  match account_entry()?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(_) => Err("keyring".into()),
  }
}

// What the signed-in app asks crema-agent.site to judge with Jev: how hard an automatic free-AI request
// is, and the sign-up guide's next step.
const SITE_POSTS: [&str; 2] = ["/api/route", "/api/onboarding/step"];

/// Posts to one of SITE_POSTS on crema-agent.site with this app's sign-in.
#[tauri::command]
async fn site_post(path: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
  if !SITE_POSTS.contains(&path.as_str()) {
    return Err("server".into());
  }
  let token = account_entry()?.get_password().map_err(|_| "signed_out".to_string())?;
  let response = http_client()?
    .post(format!("{ACCOUNT_SITE}{path}"))
    .bearer_auth(&token)
    .json(&body)
    .timeout(Duration::from_secs(5))
    .send()
    .await
    .map_err(|_| "account_unreachable".to_string())?;
  if !response.status().is_success() {
    return Err(status_error(response.status()));
  }
  response.json().await.map_err(|_| "server".to_string())
}

// The sign-up guide: a free AI's sign-up site shown as a second webview laid over the chat of the main
// window. It is a remote page, so it gets no app commands; the app only reads it, through
// guide_eval, and the user does every click and every entry.
const GUIDE: &str = "guide";

fn guide_webview(app: &AppHandle) -> Result<tauri::Webview, String> {
  app.get_webview(GUIDE).ok_or_else(|| "guide_closed".to_string())
}

fn guide_rect(x: f64, y: f64, width: f64, height: f64) -> (tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>) {
  (tauri::LogicalPosition::new(x, y), tauri::LogicalSize::new(width.max(1.0), height.max(1.0)))
}

/// Opens (or moves to) an https sign-up page in the guide webview at the given place in the window.
#[tauri::command]
async fn guide_open(app: AppHandle, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
  let url: tauri::Url = url.parse().map_err(|_| "guide_url".to_string())?;
  if url.scheme() != "https" {
    return Err("guide_url".into());
  }
  let (position, size) = guide_rect(x, y, width, height);
  if let Some(webview) = app.get_webview(GUIDE) {
    webview.navigate(url).map_err(|_| "guide_open".to_string())?;
    webview.set_position(position).map_err(|_| "guide_open".to_string())?;
    webview.set_size(size).map_err(|_| "guide_open".to_string())?;
    return webview.show().map_err(|_| "guide_open".to_string());
  }
  let window = app.get_window("main").ok_or_else(|| "guide_open".to_string())?;
  window
    .add_child(tauri::webview::WebviewBuilder::new(GUIDE, tauri::WebviewUrl::External(url)), position, size)
    .map(|_| ())
    .map_err(|_| "guide_open".to_string())
}

#[tauri::command]
fn guide_bounds(app: AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
  let webview = guide_webview(&app)?;
  let (position, size) = guide_rect(x, y, width, height);
  webview.set_position(position).map_err(|_| "guide_open".to_string())?;
  webview.set_size(size).map_err(|_| "guide_open".to_string())
}

#[tauri::command]
fn guide_close(app: AppHandle) -> Result<(), String> {
  match app.get_webview(GUIDE) {
    Some(webview) => webview.close().map_err(|_| "guide_open".to_string()),
    None => Ok(()),
  }
}

/// Runs a script in the guide page and returns its result as JSON text.
#[tauri::command]
async fn guide_eval(app: AppHandle, script: String) -> Result<String, String> {
  let webview = guide_webview(&app)?;
  let (tx, rx) = tokio::sync::oneshot::channel();
  let tx = Mutex::new(Some(tx));
  webview
    .eval_with_callback(script, move |result| {
      if let Some(tx) = tx.lock().unwrap().take() {
        let _ = tx.send(result);
      }
    })
    .map_err(|_| "guide_eval".to_string())?;
  tokio::time::timeout(Duration::from_secs(5), rx)
    .await
    .map_err(|_| "guide_eval".to_string())?
    .map_err(|_| "guide_eval".to_string())
}

/// Hides the guide page while an app overlay (settings) covers its place, and shows it again.
#[tauri::command]
fn guide_visible(app: AppHandle, visible: bool) -> Result<(), String> {
  let webview = guide_webview(&app)?;
  if visible { webview.show() } else { webview.hide() }.map_err(|_| "guide_open".to_string())
}

/// Starts the engine if needed and confirms it accepts our token without running the agent.
#[tauri::command]
async fn check_connection(app: AppHandle) -> Result<(), String> {
  let (api, _, token) = engine(&app).await?;
  let response = http_client()?
    .get(format!("{api}/v1/models"))
    .bearer_auth(token)
    .send()
    .await
    .map_err(|_| "unreachable".to_string())?;
  if !response.status().is_success() {
    return Err(status_error(response.status()));
  }
  Ok(())
}

/// The engine's model-picker inventory (providers, their models, current default). `refresh` fetches
/// each Provider's own model list now; without it the engine answers from the lists it last fetched.
#[tauri::command]
async fn model_options(app: AppHandle, refresh: bool) -> Result<serde_json::Value, String> {
  let (api, _, token) = engine(&app).await?;
  let response = http_client()?
    .get(format!("{api}/api/model/options?refresh={refresh}"))
    .bearer_auth(token)
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
  app: AppHandle,
  state: State<'_, AppState>,
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
  let (base_url, _, key) = engine(&app).await?;
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
  app: AppHandle,
  hermes_run: String,
  request_id: Option<String>,
  choice: String,
) -> Result<(), String> {
  let (base_url, _, key) = engine(&app).await?;
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

/// Per engine channel, from the engine's auth.json: `kind` ("oauth" = subscription, "api_key" …)
/// and `relogin` (a login error newer than the last successful refresh, so it can't be used now).
/// Only these metadata fields are read; tokens never leave the file.
#[tauri::command]
fn auth_kinds(app: AppHandle) -> serde_json::Value {
  let mut channels = serde_json::Map::new();
  let Some(text) = engine_home(&app).ok().and_then(|home| std::fs::read_to_string(home.join("auth.json")).ok()) else {
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

/// The agent's SOUL.md — who it is and how it speaks, its only identity. Starts the engine first, so a
/// new install reads the one the engine seeds. The engine reads the file fresh for each message.
#[tauri::command]
async fn read_soul(app: AppHandle) -> Result<String, String> {
  engine(&app).await?;
  let path = engine_home(&app)?.join("SOUL.md");
  if !path.exists() {
    return Ok(String::new());
  }
  std::fs::read_to_string(path).map_err(|_| "file_read".to_string())
}

/// Replaces SOUL.md whole (written beside it, then moved over it, so a failed save never leaves half a file).
#[tauri::command]
fn write_soul(app: AppHandle, content: String) -> Result<(), String> {
  let home = engine_home(&app)?;
  let staged = home.join("SOUL.md.saving");
  std::fs::write(&staged, content).map_err(|_| "file_write".to_string())?;
  std::fs::rename(&staged, home.join("SOUL.md")).map_err(|_| "file_write".to_string())
}

/// One request to the engine's settings API (`/api/...`): provider sign-ins, API keys, voice input.
#[tauri::command]
async fn hermes_admin(
  app: AppHandle,
  method: String,
  path: String,
  body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
  if !path.starts_with("/api/") {
    return Err("server".into());
  }
  let (_, settings, token) = engine(&app).await?;
  let client = http_client()?;
  let url = format!("{settings}{path}");
  let request = match method.as_str() {
    "GET" => client.get(url),
    "POST" => client.post(url),
    "PUT" => client.put(url),
    _ => return Err("server".into()),
  };
  let request = request.header(SETTINGS_TOKEN_HEADER, token).timeout(Duration::from_secs(60));
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

/// Copies an attached file into the engine's document cache — where Hermes' chat channels put
/// received documents — and returns the path the agent should read.
#[tauri::command]
fn stage_document(app: AppHandle, path: String) -> Result<String, String> {
  let source = PathBuf::from(&path);
  let name = source.file_name().ok_or_else(|| "file_read".to_string())?.to_string_lossy().into_owned();
  let folder = engine_home(&app).map_err(|_| "file_read".to_string())?.join("cache").join("documents");
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
async fn hermes_info(app: AppHandle, session_ids: Vec<String>) -> Result<serde_json::Value, String> {
  let (base_url, _, key) = engine(&app).await?;
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
async fn delete_session(app: AppHandle, session_id: String) -> Result<(), String> {
  let (base_url, _, key) = engine(&app).await?;
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
      sign_in,
      account_status,
      sign_out,
      site_post,
      guide_open,
      guide_bounds,
      guide_close,
      guide_eval,
      guide_visible,
      check_connection,
      model_options,
      chat_stream,
      run_approval,
      delete_session,
      hermes_info,
      auth_kinds,
      hermes_admin,
      read_soul,
      write_soul,
      read_file,
      stage_document,
      git_info,
      git_switch,
      git_create_branch,
      list_project_files,
      cancel_chat
    ])
    // The engine needs no stopping here: it ends with the app (tie_to_app).
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn pkce_challenge_matches_the_site() {
    // The server's test vector (server/web/tests.py), computed with Python's hashlib.
    assert_eq!(pkce_challenge(&"v".repeat(64)), "w1TpKUdYE9hUAcNSeeSRFioHDxfUxuHho_JHAfZ_vDM");
  }

  #[test]
  fn callback_code_needs_our_state() {
    assert_eq!(callback_code("GET /callback?code=abc&state=s1 HTTP/1.1", "s1"), Some("abc".into()));
    assert_eq!(callback_code("GET /callback?code=abc&state=other HTTP/1.1", "s1"), None);
    assert_eq!(callback_code("GET /favicon.ico HTTP/1.1", "s1"), None);
    assert_eq!(callback_code("GET /callback?state=s1 HTTP/1.1", "s1"), None);
  }
}
