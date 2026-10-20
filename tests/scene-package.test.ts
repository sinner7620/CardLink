import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import AdmZip from "adm-zip"

test("最终安装包通过宿主 /pkg/ 映射解析场景资源，经典文件入口仍可解析", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  const archive = new AdmZip(`dist/CardLink-v${pkg.version}.mnaddon`)
  const manifest = JSON.parse(archive.readAsText("mnaddon.json"))
  assert.equal(manifest.panel, "index.html")
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.addonid, "marginnote.extension.mn4-answer-matcher")
  assert.equal(manifest.title, "CardLink")
  assert.ok(manifest.events.includes("comments"))
  const html = archive.readAsText(manifest.panel)
  const base = "mnpanel://panel/index.html"
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => new URL(match[1], base))
  assert.ok(urls.length >= 5)
  for (const url of urls) {
    assert.equal(url.protocol, "mnpanel:")
    assert.ok(url.pathname.startsWith("/pkg/"), `Not a host package route: ${url}`)
    const entry = archive.getEntry(url.pathname.slice("/pkg/".length))
    assert.ok(entry, `Missing packaged resource: ${url}`)
    assert.ok(entry.getData().length > 0)
  }
  const window: any = { addEventListener() {} }
  runInNewContext(archive.readAsText("web-dist/scene-entry.js"), { window })
  const app = new URL(window.__MN_ASSET_BASE__ + "app.js", base)
  assert.ok(app.pathname.startsWith("/pkg/"))
  assert.ok(archive.getEntry(app.pathname.slice("/pkg/".length)))
  const previewHtml = archive.readAsText("web-dist/preview.html")
  assert.ok(!/<script(?![^>]*src=)|\son\w+=|\sstyle=/i.test(previewHtml))
  for (const match of previewHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1], "mnpanel://panel/pkg/web-dist/preview.html")
    assert.ok(archive.getEntry(url.pathname.slice("/pkg/".length)))
  }
  // The classic file entry must still resolve its resources in web-dist.
  const classic = archive.readAsText("web-dist/index.html")
  for (const match of classic.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1], "file:///addon/web-dist/index.html")
    assert.ok(archive.getEntry(url.pathname.replace("/addon/", "")))
  }
})
