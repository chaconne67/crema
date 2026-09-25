// Drives the INSTALLED Crema through tauri-driver (WebDriver) on a clean Windows machine: the user's
// first launch up to the Google sign-in screen, the bundled engine, a real reply, and a relaunch.
// A real Google account cannot sign in on CI, so the engine is driven through the app's own commands
// (the ones its screens call) from inside the installed app's page.
// Usage: OPENROUTER_API_KEY=… node tests/e2e/installed-app.mjs <path to installed app.exe>
const application = process.argv[2];
const driver = "http://127.0.0.1:4444";
const failures = [];

async function call(method, path, body) {
  const response = await fetch(driver + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(payload.value)}`);
  return payload.value;
}

async function until(label, read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label}: timed out (last: ${last})`);
}

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function session() {
  const created = await call("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application } } },
  });
  const id = created.sessionId;
  return {
    run: (script) => call("POST", `/session/${id}/execute/sync`, { script, args: [] }),
    close: () => call("DELETE", `/session/${id}`),
  };
}

const signInButton = "return document.querySelector('.sign-in [data-sign-in]')?.textContent || ''";

const first = await session();
await until("app window", () => first.run("return Boolean(document.querySelector('[data-open-settings]'))"), 60_000);
const family = await first.run("return getComputedStyle(document.querySelector('.sidebar')).fontFamily");
check("default font is the bundled 나눔고딕", /^"?Nanum Gothic"?/.test(family), family);
const gate = await until("sign-in screen", () => first.run(signInButton), 30_000).catch((error) => error.message);
check("first launch asks for Google sign-in", gate === "구글로 시작하기", gate);

// The app's commands, called as its screens call them; results land on window.__e2e.
const command = (name, args) => `
  window.__e2e = { done: false };
  window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args ?? {})})
    .then((value) => (window.__e2e = { done: true, value }), (error) => (window.__e2e = { done: true, error: String(error) }));`;
async function run(session, name, args, timeoutMs = 180_000) {
  await session.run(command(name, args));
  return until(name, () => session.run("return window.__e2e.done ? window.__e2e : null"), timeoutMs);
}

const started = Date.now();
const connection = await run(first, "check_connection");
check("the bundled engine starts and answers", !connection.error, connection.error || `${Math.round((Date.now() - started) / 1000)}s`);
const accounts = await run(first, "hermes_admin", { method: "GET", path: "/api/providers/oauth", body: null });
const ids = (accounts.value?.providers || []).map((provider) => provider.id);
check("the engine's settings API lists the ChatGPT sign-in", ids.includes("openai-codex"), accounts.error || ids.join(","));

const key = process.env.OPENROUTER_API_KEY || "";
if (!key) {
  check("a real reply (needs the OPENROUTER_API_KEY secret)", false, "secret not set");
} else {
  const saved = await run(first, "hermes_admin", { method: "PUT", path: "/api/env", body: { key: "OPENROUTER_API_KEY", value: key } });
  check("an API key is saved through the engine", !saved.error, saved.error || "");
  // The reply stream arrives on a channel, as in the app (desktop.js streamHermes).
  await first.run(`
    window.__reply = { text: "", done: false };
    const channel = window.__TAURI_INTERNALS__.transformCallback((raw) => {
      if (raw.message?.data) window.__reply.text += raw.message.data;
    });
    window.__TAURI_INTERNALS__.invoke("chat_stream", {
      runId: "e2e", sessionId: "crema-e2e-1", sessionKey: "crema-e2e", content: "What is 17 + 25? Reply with the number only.",
      model: "openai/gpt-4.1-mini", provider: "openrouter", system: "", modelOptions: {}, sessionTitle: "",
      onEvent: "__CHANNEL__:" + channel,
    }).then(() => (window.__reply.done = true), (error) => Object.assign(window.__reply, { done: true, error: String(error) }));`);
  const reply = await until("reply", () => first.run("return window.__reply.done ? window.__reply : null"), 240_000).catch((error) => ({ error: error.message, text: "" }));
  const completed = reply.text.split(/\r?\n/).filter((line) => line.startsWith("data:") && line.includes('"run.completed"')).map((line) => JSON.parse(line.slice(5)));
  const output = completed.at(-1)?.output || "";
  check("a real reply comes back from the provider", output.includes("42"), reply.error || output || reply.text.slice(-300));
}
await first.close();

const second = await session();
const again = await until("sign-in screen after relaunch", () => second.run(signInButton), 60_000).catch((error) => error.message);
check("still asks for sign-in after a relaunch without signing in", again === "구글로 시작하기", again);
await second.close();

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll installed-app checks passed.");
