const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "xml", "html", "css", "log", "sql",
  "py", "js", "mjs", "ts", "tsx", "jsx", "rs", "go", "java", "kt", "c", "h", "cpp", "cs", "rb", "php", "sh", "ps1",
]);

const extensionOf = (name) => name.split(".").pop().toLowerCase();
export const fileName = (path) => path.split(/[\\/]/).pop();

/** Image type for an image the model can take inline, else "". */
export function imageTypeOf(name) {
  return IMAGE_TYPES[extensionOf(name)] || "";
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The note Hermes' own chat channels put before a turn with a document (gateway/run.py
 * `_build_document_context_note`, uncached-content form): the agent reads the saved file itself.
 */
export function documentNote(name, path) {
  if (TEXT_EXTENSIONS.has(extensionOf(name))) {
    return (
      `[The user sent a text document: '${name}'. It is saved at: ${path}. ` +
      "Its content is not inlined here. Read the cached file yourself before answering " +
      "when the user's request involves its contents.]"
    );
  }
  return (
    `[The user sent a document: '${name}'. It is saved at: ${path}. ` +
    "Its text is not inlined here (it's a binary format such as PDF or DOCX). " +
    "To read it, extract the document's text yourself — for example with the " +
    "terminal tool or the ocr-and-documents skill — before answering.]"
  );
}

/**
 * Request content for one turn: document notes before the text, and images as inline parts
 * (Hermes shows them to vision models directly and describes them for the rest).
 * attachments: [{ kind: "image", dataUrl } | { kind: "file", name, stagedPath }]
 */
export function requestContent(text, attachments) {
  const notes = attachments.filter((item) => item.kind === "file").map((item) => documentNote(item.name, item.stagedPath));
  const body = [...notes, text].filter(Boolean).join("\n\n");
  const images = attachments.filter((item) => item.kind === "image");
  if (!images.length) return body;
  return [
    ...(body ? [{ type: "text", text: body }] : []),
    ...images.map((item) => ({ type: "image_url", image_url: { url: item.dataUrl } })),
  ];
}
