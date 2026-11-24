// Desktop fixture using the production preparer. Run with tsx --experimental-test-module-mocks.
import { mock } from "node:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve, basename } from "node:path"

const root = resolve("output/pdf-engine/production")
mkdirSync(root, { recursive: true })
const records = Array.from({ length: 300 }, (_, index) => ({ recordId: String(index), noteAvailable: true }))
const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="120"><rect width="500" height="120" fill="#e2e8f0"/><path d="M10 60 Q100 0 200 60 T400 60" stroke="#2454af" fill="none" stroke-width="3"/><text x="20" y="105">Signal / answer diagram</text></svg>').toString('base64')
const points = Buffer.alloc(48)
for (let i = 0; i < 3; i++) { points.writeFloatLE(30 + i * 50, i * 16); points.writeFloatLE(20 + i * 25, i * 16 + 4); points.writeFloatLE(4, i * 16 + 12) }
const pathBytes = Buffer.concat([Buffer.from([24, 3, 58, points.length]), points])
const strokeBytes = Buffer.concat([Buffer.from([42, pathBytes.length]), pathBytes])
const drawing = Buffer.concat([Buffer.from([119, 114, 100, 42, strokeBytes.length]), strokeBytes]).toString("base64")
mock.module("../src/mistake-manager", { namedExports: {
  mistakeWorkbenchData: () => ({ records }),
  mistakeDetailById: (id: string) => ({
    record: { recordId: id, sourceTitle: `题目 ${Number(id) + 1}`, sourceNotebookTitle: "信号与系统", sourcePathTitles: ["分页回归"], level: 0, createdAt: "2026-11-09", reviewCount: 1, history: [] },
    questionHtml: `<body><p>题干 ${id}：求解下列信号的卷积。</p><figure class="paint-note"><img data-media-id="diagram" src="${image}"><canvas data-drawing-id="overlay" data-drawing-overlay="true" data-drawing="${drawing}"></canvas></figure></body>`,
    answers: [{ id: `answer-${id}`, title: "解答", path: "答案", html: '<body>' + Array.from({ length: id === "3" ? 40 : 3 }, (_, n) => `<p>答案 ${id} 第 ${n + 1} 段：${"信号与系统 ABC123 ∫ f(t) dt。".repeat(12)}</p>`).join('') + '<p><math><semantics><mrow><mfrac><mi>x</mi><mn>2</mn></mfrac><mo>+</mo><mi>y</mi></mrow><annotation encoding="application/x-tex">\\frac{x}{2}+y</annotation></semantics></math></p></body>' }],
    answerStatus: "ready"
  })
} })
mock.module("../src/note-navigation", { namedExports: { recordRuntimeState() {}, captureDiagnosticError() {} } })
mock.module("marginnote", { namedExports: {
  MN: { app: { documentPath: root } }, delay: async () => {}, saveFile() {}, showHUD() {},
  writeTextFile: (path: string, text: string) => writeFileSync(resolve(root, basename(path)), text)
} })
Object.assign(globalThis, {
  NSFileManager: { defaultManager: () => ({ fileExistsAtPath: () => true, contentsOfDirectoryAtPathError: () => [], removeItemAtPath() {} }) }
})
async function main() {
const { build } = await import("esbuild")
const compiled = await build({ entryPoints: ["src/pkdrawing-core-webview.ts"], bundle: true, format: "iife", write: false })
;(globalThis as any).__PKDRAWING_CORE_SCRIPT__ = compiled.outputFiles[0].text
const { exportMistakes } = await import("../src/mistake-export")
const result = await exportMistakes({ format: "pdf", recordIds: records.map(r => r.recordId), answerLayout: "end", include: { handwriting: true } })
const entry = result.html.replace('</head>', '<link rel="stylesheet" href="/web-dist/vendor/katex.min.css"></head>').replace('</body>', '<script src="/node_modules/html2canvas/dist/html2canvas.min.js"></script><script src="/web/pdf-jpeg-writer.js"></script><script src="/web/pdf-export-runtime.js"></script></body>')
writeFileSync(resolve(root, "index.html"), entry)
writeFileSync(resolve(root, "result.json"), JSON.stringify({ count: result.count, assets: result.pdfAssets.length }))
console.log(`PDF fixture: ${root}, ${result.count} records, ${result.pdfAssets.length} staged files`)

}
main().catch(error => { console.error(error); process.exitCode = 1 })
