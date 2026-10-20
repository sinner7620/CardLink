import { build as esbuild } from "esbuild"
import { build as viteBuild } from "vite"
import AdmZip from "adm-zip"
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const repository = pkg.repository?.url?.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error("package.json repository.url 必须是 GitHub owner/repository 地址")
}

const distRoot = path.join(root, "dist")
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
      __PKDRAWING_CORE_SCRIPT__: JSON.stringify(pkdrawingCoreScript)
    },
  banner: { js: "try {" },
  footer: { js: '} catch (e) { Application.sharedInstance().alert("答案匹配-" + String(e)) }' }
})

await viteBuild({ configFile: path.join(root, "web", "vite.config.js") })
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
await writeFile(path.join(webDist, "preview-runtime.js"), pkdrawingCoreScript + "\nwindow.__mnRenderDrawings=function(){" + rendererExports.exports.pkDrawingRendererBody + "};\n")
for (const name of ["preview.html", "preview.css"]) await copyFile(path.join(root, "web", name), path.join(webDist, name))
await writeFile(path.join(webDist, "index.html"), `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>答案与错题工作台</title><link rel="icon" href="./logo.png"><link rel="stylesheet" href="./app.css"></head><body><div id="root"><p id="boot-message" role="status" style="padding:24px;font:15px system-ui;color:#666">正在载入错题工作台…</p></div><script src="./host-policy.js"></script><script src="./annotation-client.js"></script><script src="./boot.js"></script></body></html>\n`)
await copyFile(path.join(root, "web", "boot.js"), path.join(webDist, "boot.js"))
for (const name of ["host-policy.js", "annotation-client.js", "scene-entry.js", "card-menu.js"]) {
  await copyFile(path.join(root, "web", name), path.join(webDist, name))
}

await copyFile(path.join(root, "assets", "logo.png"), path.join(webDist, "logo.png"))

const vendorRoot = path.join(webDist, "vendor")
await mkdir(vendorRoot, { recursive: true })
for (const [source, name] of [
  [path.join(root, "node_modules", "html2canvas", "dist", "html2canvas.min.js"), "html2canvas.min.js"],
  [path.join(root, "node_modules", "jspdf", "dist", "jspdf.umd.min.js"), "jspdf.umd.min.js"],
  [path.join(root, "web", "pdf-export-runtime.js"), "pdf-export-runtime.js"]
]) {
  await copyFile(source, path.join(vendorRoot, name))
}

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
await copyFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), path.join(addonRoot, "THIRD_PARTY_NOTICES.txt"))
await copyFile(path.join(root,"LICENSE"),path.join(addonRoot,"LICENSE"))

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
    { id:"findAnswer", title:{"zh-Hans":"查找答案","zh-Hant":"尋找答案",en:"Find answer"} },
    { id:"markMistake", title:{"zh-Hans":"标记错题","zh-Hant":"標記錯題",en:"Mark mistake"} }
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
