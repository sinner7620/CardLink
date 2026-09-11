// 渲染冒烟测试专用：把 web 面板打成可在 Node 里 require 的 CJS bundle。
// CSS 与纯 DOM 侧效脚本替换为空模块；react/react-dom 保持 external，
// 让测试里的 react-dom/server 与 bundle 共享同一份 React 实例。
import esbuild from "esbuild"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outfile = join(root, "output", "web-smoke.cjs")

const stub = {
  name: "web-smoke-stubs",
  setup(build) {
    const empty = () => ({ contents: "module.exports = {}", loader: "js" })
    build.onResolve({ filter: /^html2canvas$/ }, () => ({ path: "html2canvas", namespace: "web-smoke-stub" }))
    build.onLoad({ filter: /.*/, namespace: "web-smoke-stub" }, () => ({ contents: "module.exports = async function html2canvasStub() { return {}; }", loader: "js" }))
    build.onLoad({ filter: /\.css$/ }, empty)
    build.onLoad({ filter: /(^|[\\/])(ui-alignment|ui-redesign|mnBridge|previewBridge)\.js$/ }, empty)
    // Phosphor/SF 图标经 Vite 的 ?raw 约定导入 SVG；Node bundle 里按文本内联。
    // packages: "external" 会先外部化整包，这里显式拉回内联（返回 file 命名空间的绝对路径）。
    build.onResolve({ filter: /^@phosphor-icons\/core\// }, args => ({
      path: join(root, "node_modules", args.path),
      namespace: "file"
    }))
    build.onLoad({ filter: /\.svg(\?raw)?$/ }, args => ({
      contents: readFileSync(args.path.replace(/\?raw$/, ""), "utf8"),
      loader: "text"
    }))
  }
}

mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  entryPoints: [join(root, "web/src/main.jsx")],
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  packages: "external",
  outfile,
  plugins: [stub],
  logLevel: "warning"
})
console.log(`web smoke bundle written to ${outfile}`)
