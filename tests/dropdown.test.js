import { beforeEach, describe, expect, it, vi } from "vitest";

import { enhanceSelect } from "../src/dropdown.js";

describe("app-drawn select", () => {
  let select;

  beforeEach(() => {
    document.body.innerHTML = `
      <label for="pick">모델</label>
      <select id="pick"><option value="a">gpt-6-sol</option><option value="b">gpt-6-luna</option></select>`;
    select = document.querySelector("#pick");
  });

  it("shows the current value, lists options with a check, and reports a choice as a change", () => {
    const onChange = vi.fn();
    select.addEventListener("change", onChange);
    enhanceSelect(select);

    const button = document.querySelector(".dropdown-button");
    expect(select.hidden).toBe(true);
    expect(document.querySelector("label").htmlFor).toBe(button.id);
    expect(button.textContent.trim()).toBe("gpt-6-sol");

    button.click();
    const items = document.querySelectorAll(".dropdown-list .menu-item");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector("svg")).not.toBeNull();

    items[1].click();
    expect(select.value).toBe("b");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(button.textContent.trim()).toBe("gpt-6-luna");
    expect(document.querySelector(".dropdown-list").hidden).toBe(true);
  });

  it("heads grouped options with their group name", () => {
    document.body.innerHTML = `<select id="font"><optgroup label="고딕"><option value="a">A</option><option value="b">B</option></optgroup><optgroup label="코딩"><option value="c">C</option></optgroup></select>`;
    enhanceSelect(document.querySelector("#font"));
    document.querySelector(".dropdown-button").click();
    const list = document.querySelector(".dropdown-list");
    expect([...list.children].map((node) => node.textContent.trim())).toEqual(["고딕", "A", "B", "코딩", "C"]);
  });

  it("follows values set in code after refresh()", () => {
    const dropdown = enhanceSelect(select);
    select.value = "b";
    dropdown.refresh();
    expect(document.querySelector(".dropdown-button").textContent.trim()).toBe("gpt-6-luna");
  });
});
