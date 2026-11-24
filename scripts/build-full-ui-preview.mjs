import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { build } from "esbuild"

const root = process.cwd()
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const outputDir = path.join(root, "ui-preview")
const output = path.join(outputDir, "CardLink-full-ui-preview.html")

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <meta name="color-scheme" content="light">
  <title>CardLink ${pkg.version} · 本地源码预览</title>
  <link rel="icon" href="data:">
  <!-- Source-linked preview: pnpm build refreshes ../web-dist and this page follows it directly. -->
  <link rel="stylesheet" href="../web-dist/harness-ui.css">
    <link rel="stylesheet" href="../web-dist/app.css">
</head>
<body>
  <div id="root"></div>
  <script>
    window.__MN_FULL_UI_PREVIEW__ = true;
    // ?scene：演示 MN5 场景模式已启用状态（AI 分析 Tab 完整界面）；默认未启用 → §12.7 引导卡。
    window.__MN_SCENE_ENABLED__ = /[?&]scene/.test(location.search) || localStorage.getItem("preview-scene") === "1";
    window.mn = window.__MN_SCENE_ENABLED__ ? {} : undefined;
    window.addEventListener("error", function (event) {
      var root = document.getElementById("root");
      if (root && !root.firstElementChild) {
        root.innerHTML = '<div style="margin:24px;padding:16px;border:1px solid #fecaca;border-radius:10px;background:#fff7f7;color:#b42318;font-family:-apple-system,BlinkMacSystemFont,\\'PingFang SC\\',sans-serif"><strong>预览页启动失败</strong><br><small>' + String((event.error && event.error.stack) ? event.error.stack.slice(0, 900) : (event.message || "未知错误")).replace(/[<&]/g, "") + '</small></div>';
      }
    });
    (function installPreviewLogoPatch() {
      function patch() {
        var image = document.querySelector(".appBrand img");
        if (!image || image.dataset.localPreviewLogo === "1") return;
        image.dataset.localPreviewLogo = "1";
        image.src = "../assets/logo.png";
      }
      var observer = new MutationObserver(patch);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener("DOMContentLoaded", patch);
      patch();
    })();
  </script>
  <script>
    // 预览专用：用一条假的 Release 载荷打开「更新确认弹窗」演示。
    // 走的是产品同一条渲染路径（App 注册的 window.__cardLinkUpdatePrompt → UpdatePromptNotes），
    // 不缩短超时、不发请求、不触发下载或安装。
    window.__CARDLINK_UPDATE_PREVIEW__ = {
      version: "9.9.9",
      channel: "正式版",
      source: "GitHub",
      currentVersion: "${pkg.version}",
      notes: "预览用纯文本摘要：真实检查更新时，这里放 Release 正文的纯文本版本，供原生系统弹窗与旧面板回退。",
      notesMarkdown: [
        "# CardLink v9.9.9",
        "",
        "本次更新把**折叠优先**的画面证据与模型状态分开，并修正更新说明的显示。",
        "",
        "## 主要改动",
        "",
        "- **折叠优先**：字段收起但画面无证据时保留遮盖，不提前摘掉",
        "- **更新说明**：支持标题、列表、\`行内码\`、代码块、引用与表格",
        "- 表格与代码只在正文内滚动，不挤压按钮",
        "",
        "### 修复",
        "",
        "1. 定位重新展开分支时最多再收起一次",
        "2. 场景面板收起时不再空等 180 秒",
        "",
        "| 版本 | 内容 |",
        "| --- | --- |",
        "| b84 | Release 正文 Markdown 渲染 |",
        "| b83 | 交互相应性修复 |",
        "",
        "\`\`\`js",
        "const folded = readBranchFolded(noteId)",
        "if (folded === true) keepMasks()",
        "\`\`\`",
        "",
        "> 更新说明来自 GitHub Release，可能包含较长章节。",
        "",
        "完整说明见 [Release 页](https://github.com/sinner7620/CardLink/releases)。"
      ].join("\\n")
    };
    // 应用挂载后才会注册 window.__cardLinkUpdatePrompt：轮询到就打开一次。
    // 关掉后可在控制台调用 window.__cardLinkUpdatePreview() 再看一次。
    (function scheduleUpdatePreview() {
      function open() {
        if (typeof window.__cardLinkUpdatePrompt !== "function") return false;
        window.__cardLinkUpdatePrompt(window.__CARDLINK_UPDATE_PREVIEW__);
        return true;
      }
      window.__cardLinkUpdatePreview = open;
      var attempts = 0;
      var timer = setInterval(function () {
        attempts += 1;
        if (open() || attempts > 120) clearInterval(timer);
      }, 100);
    })();
  </script>
  <script src="./ocr-renderer.js"></script>
  <script src="../web-dist/app.js"></script>
</body>
</html>
`

await mkdir(outputDir, { recursive: true })
await build({
  stdin: {
    contents: 'import { renderOCRMarkdownPreview } from "./src/markdown"; window.__MN_PREVIEW_RENDER_OCR__ = renderOCRMarkdownPreview;',
    resolveDir: root
  },
  bundle: true,
  minify: true,
  target: "safari13",
  outfile: path.join(outputDir, "ocr-renderer.js")
})
await writeFile(output, html)
console.log(output)
