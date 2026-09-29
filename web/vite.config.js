const path = require("node:path")
const { defineConfig } = require("vite")
const react = require("@vitejs/plugin-react")
const { readFile } = require("node:fs/promises")

module.exports = defineConfig({
  plugins: [react(), {
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
  }],
  root: __dirname,
  base: "./",
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
})
