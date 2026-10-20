export function splitCssRules(css) {
  const rules = []; let start = 0, depth = 0, quote = "", comment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i], next = css[i + 1];
    if (comment) { if (c === "*" && next === "/") { comment = false; i++; } continue; }
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "/" && next === "*") { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{") depth++;
    if (c === "}") depth--;
    if ((c === "}" && depth === 0) || (c === ";" && depth === 0)) {
      const rule = css.slice(start, i + 1).trim();
      if (rule && !/^\s*@(?:import|charset)\b/i.test(rule)) rules.push(rule);
      start = i + 1;
    }
  }
  if (depth !== 0 || quote || comment) throw new Error("预览样式不完整");
  return rules;
}

export async function publishSceneImage(src, sdk = window.mn) {
  if (!/^(data:|file:)/i.test(src || "")) return { url: src, key: null };
  const ui = await sdk.api("/ui-state");
  if (ui?.error || ui?.state?.immersive !== true) {
    await sdk.call("sceneRejected", {}).catch(() => {});
    throw new Error("已离开场景页面，图片传递已停止");
  }
  const result = await sdk.call("sceneMedia", /^file:/i.test(src) ? { file: src } : { dataUri: src });
  if (result?.error) throw new Error(result.error.message);
  if (!result?.key || result.url !== `/media/${result.key}`) throw new Error("图片传递失败");
  return result;
}

export function releaseSceneImages(keys, sdk = window.mn) {
  if (keys.length) sdk.call("sceneReleaseMedia", { keys }).catch(() => {});
}

export async function prepareSceneHtml(html, publish = publishSceneImage) {
  const keys = [], replacements = new Map();
  try {
    const sources = [...new Set(String(html).match(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g) || [])];
    for (const src of sources) {
      const media = await publish(src); keys.push(media.key); replacements.set(src, media.url);
    }
    let prepared = String(html);
    for (const [src, url] of replacements) prepared = prepared.split(src).join(url);
    return { html: prepared, keys };
  } catch (error) { releaseSceneImages(keys.filter(Boolean)); throw error; }
}

// A same-origin packaged frame already owns an allowed external stylesheet.
// Insert rules through CSSOM and apply attributes through element.style; no
// inline style/script tags, eval or data/blob frame URLs are required.
export function hydrateSceneDocument(doc, html, onImageError = () => {}) {
  const cssBlocks = [];
  const inert = String(html).replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_all, css) => { cssBlocks.push(css); return ""; })
    .replace(/\sstyle\s*=/gi, " data-scene-style-text=");
  const source = new DOMParser().parseFromString(inert, "text/html");
  const css = cssBlocks.join("\n");
  source.querySelectorAll("script,style,link,base,iframe,object,embed,meta,form").forEach(node => node.remove());
  const styles = [];
  for (const node of [source.body, ...source.body.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || /^(?:srcdoc|srcset)$/i.test(attr.name) || /^(?:javascript|data|file|blob):/i.test(attr.value.trim()) && /^(?:src|href)$/i.test(attr.name)) node.removeAttribute(attr.name);
    }
    if (node.hasAttribute("data-scene-style-text")) { styles.push(node.getAttribute("data-scene-style-text")); node.setAttribute("data-scene-style", String(styles.length - 1)); node.removeAttribute("data-scene-style-text"); }
  }
  const sheet = doc.getElementById("preview-styles")?.sheet;
  if (!sheet) throw new Error("预览样式资源未加载");
  while (sheet.cssRules.length) sheet.deleteRule(0);
  for (const rule of splitCssRules(css)) sheet.insertRule(rule, sheet.cssRules.length);
  doc.body.className = source.body.className;
  doc.body.innerHTML = source.body.innerHTML;
  const bodyStyle = source.body.getAttribute("data-scene-style");
  doc.body.style.cssText = bodyStyle === null ? "" : styles[Number(bodyStyle)];
  for (const node of doc.body.querySelectorAll("[data-scene-style]")) { node.style.cssText = styles[Number(node.dataset.sceneStyle)]; node.removeAttribute("data-scene-style"); }
  for (const image of doc.images) image.addEventListener("error", () => onImageError(new Error("卡片图片读取失败")), { once: true });
  doc.defaultView.__mnRenderDrawings();
}

// html2canvas reloads <link> sheets when cloning a document. Copy the live
// CSSOM rules as well, otherwise a scene OCR capture loses its card layout.
export function sceneCaptureOptions(doc) {
  if (!doc.getElementById("preview-styles")) return {};
  const rules = [...doc.getElementById("preview-styles").sheet.cssRules].map(rule => rule.cssText);
  return { onclone(cloned) {
    const sheet = cloned.getElementById("preview-styles")?.sheet;
    if (!sheet) throw new Error("截图样式资源未加载");
    while (sheet.cssRules.length) sheet.deleteRule(0);
    for (const rule of rules) sheet.insertRule(rule, sheet.cssRules.length);
    for (const node of cloned.querySelectorAll("[style]")) node.style.cssText = node.getAttribute("style");
  } };
}
