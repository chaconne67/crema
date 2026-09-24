import { beforeEach, describe, expect, it } from "vitest";

import { renderMarkdown } from "../src/markdown.js";

describe("renderMarkdown", () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '<div id="target"></div>';
    container = document.querySelector("#target");
  });

  it("renders GitHub-flavored Markdown and enhances code and tables", () => {
    renderMarkdown(
      container,
      `## 제목\n\n- **항목**\n- \`코드\`\n\n\`\`\`ts\nconst value = 1;\n\`\`\`\n\n| 열 | 값 |\n| --- | --- |\n| A | B |`,
    );

    expect(container.querySelector("h2")?.textContent).toBe("제목");
    expect(container.querySelector("strong")?.textContent).toBe("항목");
    expect(container.querySelector(".code-block")).not.toBeNull();
    expect(container.querySelector(".code-language")?.textContent).toBe("ts");
    expect(container.querySelector(".table-scroll table")).not.toBeNull();
  });

  it("does not execute raw HTML or unsafe attributes", () => {
    renderMarkdown(
      container,
      `안전한 문장\n\n<script>window.compromised = true</script>\n<img src=x onerror="window.compromised = true">`,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(window.compromised).toBeUndefined();
  });

  it("puts the media element in place of each Hermes MEDIA tag, keeping the path intact", () => {
    const paths = [];
    const media = (path) => {
      paths.push(path);
      const figure = document.createElement("figure");
      figure.dataset.path = path;
      return figure;
    };
    renderMarkdown(
      container,
      "그려봤어요.\n\nMEDIA:C:\\Users\\me\\cache\\images\\gpt_image_2_5-sun_20260924.png\n\n다른 분위기도 돼요.",
      { media },
    );
    expect(paths).toEqual(["C:\\Users\\me\\cache\\images\\gpt_image_2_5-sun_20260924.png"]);
    expect(container.querySelector("figure")).not.toBeNull();
    expect(container.textContent).not.toContain("MEDIA:");
    expect(container.textContent).toContain("다른 분위기도 돼요.");
  });

  it("leaves MEDIA text as written when no media renderer is given", () => {
    renderMarkdown(container, "MEDIA:/tmp/a.png");
    expect(container.textContent).toContain("MEDIA:/tmp/a.png");
  });

  it("removes unsafe link protocols", () => {
    renderMarkdown(container, "[위험한 링크](javascript:alert(1))");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

