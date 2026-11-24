const path = require("node:path")
const { defineConfig } = require("vite")
const react = require("@vitejs/plugin-react")
const { readFile } = require("node:fs/promises")

// `pnpm dev:web` 没有构建期的 Tailwind CLI 步骤，必须由官方 Vite 插件在 serve 时
// 编译 harness-tw.css（theme/utilities 层）；build 仍走 build.mjs 的 CLI 产物，
// 保持插件包单文件 CSS 与既有层序不变。仅在 serve 分支动态加载，不改变 build。
module.exports = defineConfig(async ({ command }) => {
  const plugins = [react(), {
    // The offline WebView uses the vendored, unhinted WOFF2 faces. Keep the
    // faces inline so file:// and /pkg/ entries use the same font resources.
    name: "cardlink-math-fonts",
    enforce: "pre",
    async transform(code, id) {
      if (!/katex\.min\.css(\?|$)/.test(id)) return null
      const css = code.replace(/KaTeX_/g, "CardLinkMath_")
      const faces = [...css.matchAll(/url\((?:fonts\/)?(CardLinkMath_[\w-]+\.woff2)\) format\("woff2"\)(?:,url\([^)]+\) format\("(?:woff|truetype)"\))*/g)]
      const fonts = await Promise.all(faces.map(async ([source, name]) => {
        const fontPath = path.resolve(__dirname, "../assets/cardlink-math", name)
        this.addWatchFile(fontPath)
        const font = await readFile(fontPath)
        return [source, `url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")`]
      }))
      return fonts.reduce((result, [source, replacement]) => result.replace(source, () => replacement), css)
    }
  }, {
    name: "local-screenshot-vendor",
    configureServer(server) {
      server.middlewares.use("/vendor/html2canvas.min.js", async (_request, response, next) => {
        try {
          const script = await readFile(require.resolve("html2canvas/dist/html2canvas.min.js"))
          response.setHeader("Content-Type", "application/javascript")
          response.end(script)
        } catch (error) { next(error) }
      })
    }
  }]
  if (command === "serve") {
    const { default: tailwindcss } = await import("@tailwindcss/vite")
    plugins.push(tailwindcss())
  }
  return {
    plugins,
    root: __dirname,
    base: "./",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "cn": path.resolve(__dirname, "src", "lib", "utils.ts"),
      },
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: path.resolve(__dirname, "../web-dist"),
      emptyOutDir: true,
      sourcemap: false,
      target: "es2018",
      cssCodeSplit: false,
      lib: {
        entry: path.resolve(__dirname, "src/main.jsx"),
        name: "MNAnswerMatcherWorkbench",
        formats: ["iife"],
        fileName: "app",
        cssFileName: "app"
      },
      rollupOptions: {
        output: {
          entryFileNames: "app.js",
          assetFileNames: asset => asset.name?.endsWith(".css") ? "app.css" : "[name][extname]"
        }
      }
    }
  }
})
