// Drives the INSTALLED Crema through tauri-driver (WebDriver) on a clean Windows machine: the user's
// first launch up to the Google sign-in screen, and a relaunch.
// A real Google account cannot sign in on CI, so the steps after sign-in (engine connection, first
// reply) are checked once a signed-in test account exists (engine integration plan).
// Usage: node tests/e2e/installed-app.mjs <path to installed app.exe>
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
