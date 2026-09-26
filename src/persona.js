import logo from "./crema.svg";

// Set once the first-run persona setup is saved or skipped; it is not asked again.
const DONE_KEY = "agent-client:persona:v1";

/**
 * The persona written in the setup, put in front of the current SOUL.md (the engine's Crema default on a
 * new install), which keeps its own lines on how to answer. Nothing is added for a field left empty.
 */
export function withPersona(soul, { userName, polite, agentName, wishes }) {
  const lines = [
    agentName && `당신의 이름은 ${agentName}입니다.`,
    userName && `사용자를 "${userName}"(이)라고 부릅니다.`,
    polite ? "사용자에게 항상 존댓말을 씁니다." : "사용자에게 편한 반말을 씁니다.",
    wishes && `사용자가 바라는 점:\n${wishes}`,
  ].filter(Boolean);
  return [lines.join("\n"), soul.trim()].filter(Boolean).join("\n\n") + "\n";
}

/**
 * First-run persona setup: who the agent is and how it speaks, written into SOUL.md (the only place the
 * agent's identity is set). Shown once; Settings → 페르소나 edits the file afterwards.
 */
export function createPersonaSetup({ host, storage = window.localStorage }) {
  const done = () => {
    try {
      return Boolean(storage.getItem(DONE_KEY));
    } catch {
      return false;
    }
  };
  const markDone = () => {
    try {
      storage.setItem(DONE_KEY, "1");
    } catch {
      // Without storage the setup may be offered again; the SOUL.md already written stays.
    }
  };

  return {
    /** Resolves once the setup is saved or skipped (at once when it was done before). */
    show() {
      if (done()) return Promise.resolve();
      return new Promise((resolve) => {
        const gate = document.createElement("div");
        gate.className = "sign-in persona-setup";
        gate.setAttribute("role", "dialog");
        gate.setAttribute("aria-label", "에이전트 설정");
        gate.innerHTML = `
          <img class="sign-in-logo" src="${logo}" alt="" />
          <h1>에이전트 설정</h1>
          <p>Crema 에이전트가 누구이고 어떻게 말할지 정합니다. 나중에 설정 → 페르소나에서 바꿀 수 있어요.</p>
          <form class="persona-form" data-persona-form>
            <label for="persona-user">저를 어떻게 부를까요?</label>
            <input id="persona-user" type="text" autocomplete="off" placeholder="예: 주인님, 민수님" />
            <span class="field-label">말투</span>
            <div class="segmented" role="group" aria-label="말투">
              <button type="button" data-polite="true" aria-pressed="true">존댓말</button>
              <button type="button" data-polite="false" aria-pressed="false">반말</button>
            </div>
            <label for="persona-name">에이전트 이름 (권장)</label>
            <input id="persona-name" type="text" autocomplete="off" placeholder="예: 루나" />
            <p class="field-note">이름이 있으면 어떤 모델을 쓰든 에이전트가 자기 자신을 그 이름으로 알아요.</p>
            <label for="persona-wishes">바라는 점 (선택)</label>
            <textarea id="persona-wishes" rows="3" placeholder="예: 결론부터 말해 줘. 모르면 모른다고 해 줘."></textarea>
            <button class="primary-button" type="submit">저장하고 시작</button>
            <button class="text-button" type="button" data-persona-skip>건너뛰기</button>
          </form>
          <p class="sign-in-status" role="status" data-persona-status></p>`;
        document.body.append(gate);
        const $ = (selector) => gate.querySelector(selector);
        let polite = true;
        for (const button of gate.querySelectorAll("[data-polite]")) {
          button.addEventListener("click", () => {
            polite = button.dataset.polite === "true";
            for (const other of gate.querySelectorAll("[data-polite]")) other.setAttribute("aria-pressed", String(other === button));
          });
        }
        const finish = () => {
          markDone();
          gate.remove();
          resolve();
        };
        $("#persona-user").focus();
        $("[data-persona-skip]").addEventListener("click", finish);
        $("[data-persona-form]").addEventListener("submit", async (event) => {
          event.preventDefault();
          const save = $("[type=submit]");
          save.disabled = true;
          $("[data-persona-status]").textContent = "저장하고 있습니다…";
          try {
            const persona = {
              userName: $("#persona-user").value.trim(),
              polite,
              agentName: $("#persona-name").value.trim(),
              wishes: $("#persona-wishes").value.trim(),
            };
            await host.writeSoul(withPersona(await host.readSoul(), persona));
            finish();
          } catch (error) {
            $("[data-persona-status]").textContent = error.userMessage || "저장하지 못했습니다. 다시 시도해 주세요.";
            save.disabled = false;
          }
        });
      });
    },
  };
}
