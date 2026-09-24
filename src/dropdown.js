import { CHECK_ICON } from "./commands.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

/**
 * Replaces a native <select>'s OS-drawn list with a rounded one matching the app.
 * The <select> stays (hidden) as the source of truth: callers keep reading `.value`,
 * rebuilding options, and listening for "change"; call refresh() after changing it in code.
 */
export function enhanceSelect(select) {
  const wrapper = document.createElement("div");
  wrapper.className = "dropdown";
  wrapper.innerHTML = `
    <button type="button" class="dropdown-button" aria-haspopup="listbox" aria-expanded="false"><span></span></button>
    <div class="dropdown-list" role="listbox" hidden></div>`;
  select.hidden = true;
  select.after(wrapper);

  const button = wrapper.querySelector(".dropdown-button");
  const list = wrapper.querySelector(".dropdown-list");
  button.id = `${select.id}-button`;
  const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
  if (label) label.htmlFor = button.id;
  let active = -1;

  function refresh() {
    button.querySelector("span").textContent = select.options[select.selectedIndex]?.textContent || "";
  }

  function render() {
    let group = "";
    list.innerHTML = [...select.options]
      .map((option, index) => {
        // <optgroup> labels head their options, like section titles.
        const label = option.parentElement.tagName === "OPTGROUP" ? option.parentElement.label : "";
        const heading = label && label !== group ? `<div class="menu-heading">${escapeHtml(label)}</div>` : "";
        group = label;
        return `${heading}
        <button type="button" class="menu-item${index === active ? " active" : ""}" role="option" data-index="${index}" aria-selected="${option.selected}">
          <span class="menu-icon">${option.selected ? CHECK_ICON : ""}</span>
          <span class="menu-label">${escapeHtml(option.textContent)}</span>
          <span class="menu-hint"></span>
        </button>`;
      })
      .join("");
    list.querySelector(".menu-item.active")?.scrollIntoView?.({ block: "nearest" });
  }

  function close() {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function open() {
    active = select.selectedIndex;
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    // Open upward when the panel has no room below.
    const room = (button.closest(".settings-body") || document.body).getBoundingClientRect().bottom - button.getBoundingClientRect().bottom;
    wrapper.classList.toggle("up", room < Math.min(list.scrollHeight, 280) + 12);
    render();
  }

  function choose(index) {
    close();
    button.focus();
    if (index < 0 || index === select.selectedIndex) return;
    select.selectedIndex = index;
    refresh();
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  button.addEventListener("click", () => (list.hidden ? open() : close()));
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-index]");
    if (item) choose(Number(item.dataset.index));
  });
  button.addEventListener("keydown", (event) => {
    const count = select.options.length;
    if (list.hidden) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      render();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close();
    }
  });
  document.addEventListener("mousedown", (event) => {
    if (!list.hidden && !wrapper.contains(event.target)) close();
  });

  refresh();
  return { refresh };
}
