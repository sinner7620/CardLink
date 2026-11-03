import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import AdmZip from "adm-zip"
import ts from 'typescript'

test("最终安装包通过宿主 /pkg/ 映射解析场景资源，经典文件入口仍可解析", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  const archive = new AdmZip(`dist/CardLink-v${pkg.version}.mnaddon`)
  const manifest = JSON.parse(archive.readAsText("mnaddon.json"))
  assert.equal(manifest.panel, "index.html")
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.addonid, "marginnote.extension.mn4-answer-matcher")
  assert.equal(manifest.title, "CardLink")
  const core = ts.createSourceFile('AnswerMatcherCore.js', archive.readAsText('AnswerMatcherCore.js'), ts.ScriptTarget.Latest, true)
  let nativeMethods: ts.ObjectLiteralExpression | undefined
  function findMethods(node: ts.Node): void {
    if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && node.left.name.text === '__MN_ANSWER_CORE_GLOBAL__' && ts.isObjectLiteralExpression(node.right)) {
      const methods = node.right.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(core) === 'instanceMethods')
      if (methods && ts.isPropertyAssignment(methods) && ts.isObjectLiteralExpression(methods.initializer)) nativeMethods = methods.initializer
    }
    ts.forEachChild(node, findMethods)
  }
  findMethods(core)
  assert.ok(nativeMethods, '交付包必须包含正式 Rails 原生方法表')
  const methodNames = nativeMethods.properties.map(property => property.name?.getText(core))
  for (const name of ['onReviewModeReason', 'onReviewModeMark', 'onReviewModeNext', 'onReviewModeToolbarResult',
    'onCardMistakePanelLevel', 'onCardMistakePanelReason', 'onCardMistakePanelSkip', 'onCardMistakePanelOutsideTap', 'onCardMistakePanelClose'])
    assert.ok(methodNames.includes(name), `交付包的正式入口缺少 ${name}`)
  // The crash-prone b15 drawing bridge must not survive in the delivered core.
  assert.doesNotMatch(archive.readAsText('AnswerMatcherCore.js'), /CAShapeLayer|bezierPathWithArcCenterRadiusStartAngleEndAngleClockwise/)
  assert.equal(archive.getEntries().filter(entry => /^review-toolbar\/progress-/.test(entry.entryName)).length, 0)
  for (const name of ['previous', 'next', 'answer', 'category', 'collapse', 'forward', 'history', 'mark', 'exit']) {
    const icon = archive.getEntry(`review-toolbar/${name}.png`)
    assert.ok(icon, `missing native toolbar icon ${name}`)
    const bytes = icon.getData()
    assert.equal(bytes.readUInt32BE(0), 0x89504e47)
    assert.equal(bytes[25], 6, `native icon must retain RGBA transparency: ${name}`)
  }
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
