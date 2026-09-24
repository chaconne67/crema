import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { marked } from "marked";

for (const [name, language] of Object.entries({
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  sql,
  typescript,
  xml,
})) {
  hljs.registerLanguage(name, language);
}

const LANGUAGE_ALIASES = {
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html(token) {
      return escapeHtml(token.text || token.raw || "");
    },
  },
});

function enhanceCodeBlocks(container) {
  for (const code of container.querySelectorAll("pre > code")) {
    const pre = code.parentElement;
    if (!pre || pre.parentElement?.classList.contains("code-block")) continue;

    const rawLanguage = [...code.classList]
      .find((className) => className.startsWith("language-"))
      ?.slice("language-".length);
    const normalizedLanguage = LANGUAGE_ALIASES[rawLanguage] || rawLanguage;
    const source = code.textContent.replace(/\n$/, "");

    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      const highlighted = hljs.highlight(source, { language: normalizedLanguage }).value;
      code.innerHTML = DOMPurify.sanitize(highlighted, {
        ALLOWED_TAGS: ["span"],
        ALLOWED_ATTR: ["class"],
      });
    } else {
      code.textContent = source;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "code-block";

    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";

    const label = document.createElement("span");
    label.className = "code-language";
    label.textContent = rawLanguage || "text";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "code-copy-button";
    copyButton.dataset.copyCode = "";
    copyButton.setAttribute("aria-label", "코드 복사");
    copyButton.textContent = "복사";

    toolbar.append(label, copyButton);
    pre.before(wrapper);
    wrapper.append(toolbar, pre);
  }
}

function enhanceTables(container) {
  for (const table of container.querySelectorAll("table")) {
    if (table.parentElement?.classList.contains("table-scroll")) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "table-scroll";
    table.before(wrapper);
    wrapper.append(table);
  }
}

// Hermes marks a file it produced (e.g. a generated image) as `MEDIA:<absolute path>` on its own.
const MEDIA_TAG = /MEDIA:\s*(`[^`\n]+`|"[^"\n]+"|(?:[A-Za-z]:[\\/]|\/)[^\n]*?\.(?:png|jpe?g|gif|webp|bmp))/gi;
const MEDIA_TOKEN = "AGENTCLIENTMEDIA";

/**
 * Renders Markdown. With `media`, each Hermes `MEDIA:<path>` tag becomes the element `media(path)`
 * returns, in its own block (the tag is pulled out first so Markdown never mangles the path).
 */
export function renderMarkdown(container, source, { media } = {}) {
  const paths = [];
  if (media) {
    source = (source || "").replace(MEDIA_TAG, (_, path) => {
      paths.push(path.replace(/^[`"]|[`"]$/g, ""));
      return `\n\n${MEDIA_TOKEN}${paths.length - 1}\n\n`;
    });
  }
  const unsafeHtml = marked.parse(source || "");
  container.innerHTML = DOMPurify.sanitize(unsafeHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["form", "iframe", "object", "embed", "style"],
    FORBID_ATTR: ["style"],
  });

  for (const link of container.querySelectorAll("a[href]")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  enhanceCodeBlocks(container);
  enhanceTables(container);

  for (const block of paths.length ? container.querySelectorAll("p") : []) {
    const index = block.textContent.startsWith(MEDIA_TOKEN) ? Number(block.textContent.slice(MEDIA_TOKEN.length)) : NaN;
    if (paths[index] !== undefined) block.replaceWith(media(paths[index]));
  }
}

