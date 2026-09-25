// Drives the INSTALLED Crema through tauri-driver (WebDriver) on a clean Windows machine:
// the user's path from first launch to a working "이 PC" connection, then a relaunch.
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
  const find = (css) => call("POST", `/session/${id}/element`, { using: "css selector", value: css });
  const element = (found) => Object.values(found)[0];
  return {
    id,
    run: (script, args = []) => call("POST", `/session/${id}/execute/sync`, { script, args }),
    click: async (css) => call("POST", `/session/${id}/element/${element(await find(css))}/click`, {}),
    text: async (css) => call("GET", `/session/${id}/element/${element(await find(css))}/text`),
    close: () => call("DELETE", `/session/${id}`),
  };
}

const first = await session();
await until("app window", () => first.run("return Boolean(document.querySelector('[data-open-settings]'))"), 60_000);

const family = await first.run("return getComputedStyle(document.querySelector('.sidebar')).fontFamily");
check("default font is the bundled 나눔고딕", /^"?Nanum Gothic"?/.test(family), family);

await first.click("[data-open-settings]");
const status = await until(
  "connection check",
  async () => {
    const line = await first.text("[data-connection-line]");
    return /연결되었습니다|꺼져 있습니다|응답하지 않습니다|찾지 못했습니다/.test(line) && line;
  },
  60_000,
);
console.log(`first status: ${status}`);
if (!/연결되었습니다/.test(status)) {
  await first.click("[data-enable-local]");
  const after = await until(
    "Hermes 연결 켜기",
    async () => {
      const line = await first.text("[data-connection-line]");
      return !/켜고 있습니다|확인하고 있습니다/.test(line) && line;
    },
    240_000,
  ).catch((error) => error.message);
  check("Hermes 연결 켜기 connects this PC", /연결되었습니다/.test(after), after);
} else {
  check("this PC connected on first launch", true, status);
}

const saved = await first.run("return localStorage.getItem('agent-client:workspace:v1')");
check("workspace saved to storage", Boolean(saved));
await first.close();

const second = await session();
await until("app window after relaunch", () => second.run("return Boolean(document.querySelector('[data-open-settings]'))"), 60_000);
const reloaded = await second.run("return localStorage.getItem('agent-client:workspace:v1')");
check("workspace survives a relaunch", Boolean(reloaded) && JSON.parse(reloaded).activeChatId === JSON.parse(saved || "{}").activeChatId);
await second.close();

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll installed-app checks passed.");
