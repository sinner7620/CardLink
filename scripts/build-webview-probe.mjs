import { build } from "esbuild"
import AdmZip from "adm-zip"
import { mkdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { createServer } from "node:http"
import { buildAnswerInk } from "./build-answer-ink.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const scene = process.argv[2] === "--scene"
const version = "0.1.0-b6"
const manifest = {
  addonid: scene ? "marginnote.extension.cardlink-scene-ink-probe" : "marginnote.extension.cardlink-webview-probe",
  author: "frank",
  title: scene ? "CardLink 场景书写测试" : "CardLink WebView 测试",
  version,
  marginnote_version_min: scene ? "4.5.0" : "4.0.0",
  cert_key: "",
  ...(scene ? { immersiveOnly: true, panel: "index.html", icon: "logo.png", panelWidth: 837, panelMaxHeight: 655 } : {}),
}
const options = { absWorkingDir: root, bundle: true, minify: true, platform: "browser",
  target: "safari13", format: "iife", write: false }
async function inline(entry, loader) {
  const result = await build({ ...options, entryPoints: [entry], loader })
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")
}
const [core, ink, report] = await Promise.all([
  inline("src/pkdrawing-core-webview.ts"),
  buildAnswerInk(root),
  inline("web/webview-probe.js"),
])
const addon = await build({
  ...options, entryPoints: ["src/webview-probe.ts"], globalName: "__CARDLINK_STANDALONE_PROBE__",
  define: {
    __PKDRAWING_CORE_SCRIPT__: JSON.stringify(core),
    __PROBE_INK_SCRIPT__: JSON.stringify(ink),
    __PROBE_REPORT_SCRIPT__: JSON.stringify(report),
  },
  footer: { js: "JSB.newAddon = function () { return __CARDLINK_STANDALONE_PROBE__.createProbeAddon(); };" },
})
if (process.argv[2] === "--serve") {
  const [, , , address, port = "8767"] = process.argv
  if (!address) throw new Error("Provide the WLAN IPv4 address")
  const sandbox = { JSB: {} }
  runInNewContext(addon.outputFiles[0].text, sandbox)
  const page = sandbox.__CARDLINK_STANDALONE_PROBE__.rawDocument(true)
  createServer((request, response) => {
    if (request.url !== "/" || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
      .end(request.method === "HEAD" ? undefined : page)
  }).listen(Number(port), address, () => console.log(`http://${address}:${port}/`))
} else await writeArchive()

async function writeArchive() {
  const zip = new AdmZip()
  zip.addFile("mnaddon.json", Buffer.from(JSON.stringify(manifest, null, 2)))
  if (scene) {
    const sandbox = { JSB: {} }
    runInNewContext(addon.outputFiles[0].text, sandbox)
    zip.addFile("index.html", Buffer.from(sandbox.__CARDLINK_STANDALONE_PROBE__.sceneDocument()))
    zip.addFile("scene-config.js", Buffer.from('window.cardLinkAnswerInkConfig = { token: "scene-probe", debug: true };'))
    zip.addFile("answer-ink.js", Buffer.from(ink))
    zip.addFile("probe-report.js", Buffer.from(report))
  } else zip.addFile("main.js", Buffer.from(addon.outputFiles[0].text))
  for (const [entry, source] of [
    ["logo.png", "assets/review-toolbar/answer.png"],
    ["LICENSE", "LICENSE"],
    ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
    ["RELEASE_NOTES.md", `docs/release-notes/RELEASE_NOTES_v${version}.md`],
  ]) {
    zip.addFile(entry, await readFile(join(root, source)))
  }
  const dist = join(root, "dist")
  await mkdir(dist, { recursive: true })
  const archive = join(dist, `CardLink-${scene ? "Scene-Ink" : "WebView"}-Probe-v${version}.mnaddon`)
  zip.writeZip(archive)
  console.log(archive)
}
