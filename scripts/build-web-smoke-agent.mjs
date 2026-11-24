/**
 * 渲染冒烟测试专用：Harness P4-3 新组件（AgentPanel/HarnessSyncCard/HarnessSettings）
 * 的 CJS bundle。与 web-smoke.cjs 同策略（CSS 置空、react external）；
 * 生产入口不引用本文件。
 */
import esbuild from "esbuild"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outfile = join(root, "output", "web-smoke-agent.cjs")

const stub = {
  name: "web-smoke-agent-stubs",
  setup(build) {
    const empty = () => ({ contents: "module.exports = {}", loader: "js" })
    // packages:"external" 会把依赖里的 CSS 留成运行时 require（Node 无法解析）；
    // onResolve 重定向到空占位（优先于 external），再由下方 onLoad 以空内容内联。
    build.onResolve({ filter: /(?:@assistant-ui[\\/]react-markdown[\\/]styles[\\/]dot\.css|katex16[\\/]dist[\\/]katex\.min\.css)$/ }, () => ({
      path: join(root, "web/src/ui/smoke-stub.css"),
    }))
    // 同 web-smoke：external 依赖里的 CSS 也重定向到空占位，避免运行时 require('.css')。
    build.onResolve({ filter: /\.css$/ }, () => ({ path: join(root, "web/src/ui/smoke-stub.css") }))
    build.onLoad({ filter: /\.css$/ }, empty)
    build.onLoad({ filter: /(^|[\\/])mnBridge\.js$/ }, empty)
    build.onLoad({ filter: /(^|[\\/])previewBridge\.js$/ }, empty)
  }
}

mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  entryPoints: [join(root, "web/src/agent-smoke-entry.jsx")],
  bundle: true,
  alias: { "@": join(root, "web", "src") },
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  packages: "external",
  outfile,
  plugins: [stub],
  logLevel: "warning"
})
console.log(`web smoke agent bundle written to ${outfile}`)
