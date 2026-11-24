import { build as esbuild } from "esbuild"
import { build as viteBuild } from "vite"
import AdmZip from "adm-zip"
import { spawnSync } from "node:child_process"
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { buildAnswerInk } from "./scripts/build-answer-ink.mjs"

const root = process.cwd()
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const repository = pkg.repository?.url?.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error("package.json repository.url 必须是 GitHub owner/repository 地址")
}

// 安装包输出目录。默认 dist/；设置 CARDLINK_DIST_DIR 可把安装包与暂存目录写到别处，
// 用于在不覆盖已交付的同版本安装包时验证构建（web-dist/ 仍按原位置生成）。
const distRoot = path.resolve(process.env.CARDLINK_DIST_DIR || path.join(root, "dist"))
const addonRoot = path.join(distRoot, "CardLink")
const webDist = path.join(root, "web-dist")
// 渠道是正式版项目的固定属性，与版本号解耦：版本号按 2.3.3-beta.N 迭代时
// 仍构建正式插件 ID，保证 MarginNote 内原地升级；mnChannel: "beta" 仅保留给独立 Beta 工作树。
const betaChannel = pkg.mnChannel === "beta"
const localBeta = pkg.version.includes("beta.local")
const archive = path.join(
  distRoot,
  `${localBeta ? "CardLink-Beta" : "CardLink"}-v${pkg.version}.mnaddon`
)

await mkdir(distRoot, { recursive: true })
await rm(addonRoot, { recursive: true, force: true })
await rm(archive, { force: true })
await rm(webDist, { recursive: true, force: true })
await mkdir(addonRoot, { recursive: true })

// R3：PKDrawing 解码器单一来源——把 pkdrawing-core 编译成 webview IIFE，
// 注入画布脚本（pkdrawing-renderer.ts），与 TS 侧共用同一实现。
const pkdrawingCoreBuild = await esbuild({
  entryPoints: [path.join(root, "src", "pkdrawing-core-webview.ts")],
  bundle: true,
  minify: true,
  platform: "browser",
  target: "safari13",
  format: "iife",
  write: false
})
const pkdrawingCoreScript = pkdrawingCoreBuild.outputFiles[0].text.trim()
// 脚本最终嵌入卡片 HTML 的 <script> 标签，不能包含会提前闭合标签的序列
if (/<\/script/i.test(pkdrawingCoreScript)) {
  throw new Error("PKDrawing core 脚本包含 </script> 序列，无法安全嵌入 HTML")
}

const previewBuild = await esbuild({
  entryPoints: [path.join(root, "src", "card-preview-webview.ts")],
  bundle: true, minify: true, platform: "browser", target: "safari13", format: "iife", write: false
})
const cardPreviewScript = previewBuild.outputFiles[0].text.trim()
if (/<\/script/i.test(cardPreviewScript)) throw new Error("Card preview script contains a closing script tag")

const inkBuild = await esbuild({
  entryPoints: [path.join(root, "web", "plugin-ink.js")],
  loader: { '.css': 'text' },
  bundle: true, minify: true, platform: "browser", target: "safari13", format: "iife", write: false
})
const pluginInkScript = inkBuild.outputFiles[0].text.trim().replace(/<\/script/gi, "<\\/script")

const answerInkScript = await buildAnswerInk(root, { sharedCapture: true })

const completionBuild = await esbuild({
  entryPoints: [path.join(root, "web", "review-completion-effect.js")],
  bundle: true, minify: true, platform: "browser", target: "safari13", format: "iife", write: false
})
const reviewCompletionScript = completionBuild.outputFiles[0].text.trim()
if (/<\/script/i.test(reviewCompletionScript)) throw new Error("Review completion script contains a closing script tag")

await esbuild({
  entryPoints: [path.join(root, "src", "rails-core.ts")],
  outfile: path.join(addonRoot, "AnswerMatcherCore.js"),
  bundle: true,
  minify: true,
  platform: "browser",
  target: "safari13",
  define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __MN_CHANNEL__: JSON.stringify(betaChannel ? "beta" : "stable"),
      __GITHUB_REPOSITORY__: JSON.stringify(repository),
      __PKDRAWING_CORE_SCRIPT__: JSON.stringify(pkdrawingCoreScript),
      __CARD_PREVIEW_SCRIPT__: JSON.stringify(cardPreviewScript),
      __PLUGIN_INK_SCRIPT__: JSON.stringify(pluginInkScript),
      __ANSWER_INK_SCRIPT__: JSON.stringify(answerInkScript),
      __ANSWER_INK_CARD_WRITE__: "false",
      __REVIEW_COMPLETION_SCRIPT__: JSON.stringify(reviewCompletionScript)
    },
  banner: { js: "try {" },
  footer: { js: '} catch (e) { Application.sharedInstance().alert("答案匹配-" + String(e)) }' }
})

await viteBuild({ configFile: path.join(root, "web", "vite.config.js") })

// Harness UI(§3.1):Tailwind v4 CLI 预编译独立样式(与 vite lib 模式解耦;
// 入口不含 preflight,插件既有页面不受影响)。内容扫描 web 源码。
const tailwindCli = path.join(root, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs")
const tailwindRun = spawnSync(process.execPath, [
  tailwindCli, "-i", path.join(root, "web", "src", "ui", "harness-tw.css"),
  "-o", path.join(webDist, "harness-ui.css"),
  "--content", (root + "/web/src/**/*.{jsx,js}"),
], { cwd: root, encoding: "utf8" })
if (tailwindRun.status !== 0) {
  if (tailwindRun.stderr) console.error(tailwindRun.stderr)
  throw new Error("Harness UI Tailwind 编译失败")
}
await esbuild({ entryPoints:[path.join(root,"web","card-command-surface.js")],outfile:path.join(webDist,"card-command-surface.js"),bundle:true,minify:true,format:"iife",platform:"browser",target:"safari13" })

// A packaged, same-origin frame replaces srcDoc in scene panels. Drawing code
// is emitted at build time; the frame never evaluates scripts from card HTML.
const rendererBuild = await esbuild({
  stdin: { contents: 'export { pkDrawingRendererBody } from "./src/pkdrawing-renderer"', resolveDir: root },
  bundle: true, format: "cjs", platform: "node", write: false
})
const rendererExports = { exports: {} }
const { runInNewContext } = await import("node:vm")
runInNewContext(rendererBuild.outputFiles[0].text, { module: rendererExports, exports: rendererExports.exports })
await writeFile(path.join(webDist, "preview-runtime.js"), cardPreviewScript + "\n" + pkdrawingCoreScript + "\nwindow.__mnRenderDrawings=function(){" + rendererExports.exports.pkDrawingRendererBody + "};\n")
for (const name of ["preview.html", "preview.css"]) await copyFile(path.join(root, "web", name), path.join(webDist, name))
await writeFile(path.join(webDist, "index.html"), `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"><title>答案与错题工作台</title><link rel="icon" href="./logo.png"><link rel="stylesheet" href="./harness-ui.css"><link rel="stylesheet" href="./app.css"></head><body><div id="root"><p id="boot-message" role="status" style="padding:24px;font:15px system-ui;color:#666">正在载入错题工作台…</p></div><script src="./host-policy.js"></script><script src="./annotation-client.js"></script><script src="./boot.js"></script></body></html>\n`)
await copyFile(path.join(root, "web", "boot.js"), path.join(webDist, "boot.js"))
for (const name of ["host-policy.js", "annotation-client.js", "scene-entry.js", "card-menu.js"]) {
  await copyFile(path.join(root, "web", name), path.join(webDist, name))
}

await copyFile(path.join(root, "assets", "logo.png"), path.join(webDist, "logo.png"))

const vendorRoot = path.join(webDist, "vendor")
await mkdir(vendorRoot, { recursive: true })
for (const [source, name] of [
  [path.join(root, "node_modules", "html2canvas", "dist", "html2canvas.min.js"), "html2canvas.min.js"],
  [path.join(root, "web", "pdf-jpeg-writer.js"), "pdf-jpeg-writer.js"],
  [path.join(root, "web", "pdf-export-runtime.js"), "pdf-export-runtime.js"]
]) {
  await copyFile(source, path.join(vendorRoot, name))
}

// Keep KaTeX layout rules and let the WebView use its system font fallback.
const katexCss = await readFile(path.join(root, "node_modules", "katex", "dist", "katex.min.css"), "utf8")
await writeFile(path.join(vendorRoot, "katex.min.css"), katexCss.replace(/@font-face\s*\{[^{}]*\}/g, ""))

// The local demo consumes the exact web-dist bundle shipped by the plugin.
// Refresh its source-linked HTML on every complete build as one artifact set.
await import("./scripts/build-full-ui-preview.mjs")

await copyFile(path.join(root, "web", "host-policy.js"), path.join(addonRoot, "host-policy.js"))
for (const name of ["main.js", "SceneMedia.js", "SceneWorkbench.js", "ui-constants.js", "WebBridgeCommands.js", "WebPanelController.js", "WebAddon.js"]) {
  await copyFile(path.join(root, "rails-native", name), path.join(addonRoot, name))
}

const entrySource = await readFile(path.join(addonRoot, "main.js"), "utf8")
for (const match of entrySource.matchAll(/JSB\.require\("([^"]+)"\)/g)) {
  const moduleName = match[1]
  if (moduleName.endsWith(".js")) throw new Error(`JSB.require 模块名不能带 .js：${moduleName}`)
  try {
    await readFile(path.join(addonRoot, `${moduleName}.js`))
  } catch {
    throw new Error(`JSB.require 对应模块不存在：${moduleName}.js`)
  }
}
await cp(webDist, path.join(addonRoot, "web-dist"), { recursive: true })
// Scene pages are served at mnpanel://panel/index.html; assets resolve from
// /pkg/ maps to the package root (same as the reference cardpractice plugin).
// Keep the file:// classic entry under web-dist unchanged.
await copyFile(path.join(root, "web", "scene-index.html"), path.join(addonRoot, "index.html"))
await copyFile(path.join(root, "assets", "logo.png"), path.join(addonRoot, "logo.png"))
await cp(path.join(root, "assets", "review-toolbar"), path.join(addonRoot, "review-toolbar"), { recursive: true })
await copyFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), path.join(addonRoot, "THIRD_PARTY_NOTICES.txt"))
await copyFile(path.join(root,"LICENSE"),path.join(addonRoot,"LICENSE"))
// Package the license texts for redistributed fonts, libraries, and UI assets.
const licenseFiles = [
  ["assets/cardlink-math/OFL.txt", "CardLink-Math-OFL.txt"],
  ["node_modules/preact/LICENSE", "Preact-LICENSE.txt"],
  ["node_modules/highlight.js/LICENSE", "Highlight.js-LICENSE.txt"],
  ["node_modules/lowlight/license", "Lowlight-LICENSE.txt"],
  ["node_modules/hast-util-to-text/license", "hast-util-to-text-LICENSE.txt"],
  ["node_modules/unist-util-visit/license", "unist-util-visit-LICENSE.txt"],
  ["web/src/vendor/dsh-context/LICENSE", "dsh-context-LICENSE.txt"],
  ["web/src/vendor/dsh-cost-meter/LICENSE", "dsh-cost-meter-LICENSE.txt"],
]
await mkdir(path.join(addonRoot, "licenses"), { recursive: true })
for (const [source, name] of licenseFiles) {
  await copyFile(path.join(root, ...source.split("/")), path.join(addonRoot, "licenses", name))
}

const manifest = {
  addonid: betaChannel
    ? "marginnote.extension.mn4-answer-matcher.beta"
    : "marginnote.extension.mn4-answer-matcher",
  author: "frank",
  title: betaChannel ? "CardLink Beta" : "CardLink",
  version: pkg.version,
  marginnote_version_min: "4.0.0",
  panel: "index.html",
  panelWidth: 640,
  panelMaxHeight: 1000,
  events: ["practice", "comments"],
  cardCommands: [
    { id:"findAnswer", title:{"zh-Hans":"答案","zh-Hant":"答案",en:"Find answer"} },
    { id:"markMistake", title:{"zh-Hans":"标错","zh-Hant":"標錯",en:"Mark mistake"} }
  ],
  cert_key: ""
}
await writeFile(path.join(addonRoot, "mnaddon.json"), `${JSON.stringify(manifest, null, 2)}\n`)

const zip = new AdmZip()
async function addDirectory(directory, prefix = "") {
  const { readdir } = await import("node:fs/promises")
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) await addDirectory(absolute, relative)
    else zip.addFile(relative, await readFile(absolute))
  }
}
await addDirectory(addonRoot)
zip.writeZip(archive)
console.log(`Built MN Rails web add-on ${archive}`)
