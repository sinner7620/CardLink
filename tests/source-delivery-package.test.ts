import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import AdmZip from "adm-zip"

test("安装包包含编译后的尺寸玻璃控件，但不附源码压缩包或原始上游文件", () => {
  const pkg = JSON.parse(readFileSync('package.json','utf8'))
  const zip = new AdmZip(`dist/CardLink-v${pkg.version}.mnaddon`)
  const manifest = JSON.parse(zip.readAsText('mnaddon.json'))
  assert.equal(manifest.version,pkg.version)
  assert.equal(manifest.addonid,'marginnote.extension.mn4-answer-matcher')
  assert.equal(manifest.title,'CardLink');assert.equal(pkg.mnChannel,'stable')
  assert.deepEqual(manifest.cardCommands.map((command:any)=>command.id),['findAnswer','markMistake'])
  assert.equal(zip.getEntry('SOURCE.zip'),null)
  assert.equal(zip.getEntry('SOURCE-INFO.txt'),null)
  assert.equal(zip.getEntry('html-to-image-LICENSE.txt'),null)
  assert.equal(zip.getEntry('liquid-glass-LICENSE.txt'),null)
  assert.doesNotMatch(zip.readAsText('AnswerMatcherCore.js'),/__answerGlass|answerGlassRequested|setReviewGlass/)
  assert.equal(pkg.dependencies['html-to-image'],undefined)
  assert.ok(zip.getEntry('LICENSE'))
  assert.ok(zip.getEntry('web-dist/size-grid.svg'))
  assert.equal(zip.getEntries().some(entry => /\.(tsx?|map)$/.test(entry.entryName) || entry.entryName.includes('liquid-glass-webgl/')), false)
  assert.ok(zip.getEntry('web-dist/card-command-surface.js'))
  assert.match(zip.readAsText('index.html'),/card-command-surface.js/)
  assert.equal(existsSync(`dist/CardLink-v${pkg.version}-source.zip`),false)
  assert.equal(existsSync(`dist/刷题-卡片-CardLink-${pkg.version.split('-')[1]}.mntemplate`),false)
})
