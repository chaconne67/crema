import logo from "./crema.svg";

/**
 * First-run gate: Crema starts with a Google sign-in at crema-agent.site. `show()` resolves with
 * the account once the browser hands the sign-in back to the app.
 */
export function createSignIn({ host }) {
  return {
    show() {
      return new Promise((resolve) => {
        const gate = document.createElement("div");
        gate.className = "sign-in";
        gate.setAttribute("role", "dialog");
        gate.setAttribute("aria-label", "Crema 시작하기");
        gate.innerHTML = `
          <img class="sign-in-logo" src="${logo}" alt="" />
          <h1>Crema</h1>
          <p>구글 계정으로 시작합니다.</p>
          <button class="primary-button" type="button" data-sign-in>구글로 시작하기</button>
          <p class="sign-in-status" role="status" data-sign-in-status></p>`;
        document.body.append(gate);
        const button = gate.querySelector("[data-sign-in]");
        const status = gate.querySelector("[data-sign-in-status]");
        button.focus();
        button.addEventListener("click", async () => {
          button.disabled = true;
          status.textContent = "브라우저에서 구글 로그인을 마쳐 주세요.";
          try {
            const account = await host.signIn();
            gate.remove();
            resolve(account);
          } catch (error) {
            status.textContent = error.userMessage || "로그인하지 못했습니다. 다시 시도해 주세요.";
            button.disabled = false;
          }
        });
      });
    },
  };
}
