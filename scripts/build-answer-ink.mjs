import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function buildAnswerInk(root, { minify = true, sharedCapture = false } = {}) {
  const { outputFiles } = await build({
    absWorkingDir: root,
    entryPoints: ['web/answer-ink.js'],
    outfile: resolve(root, 'answer-ink.js'),
    bundle: true,
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      ...(sharedCapture ? { html2canvas: resolve(root, 'web/src/lib/answer-ink-capture.js') } : {})
    },
    minify,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    define: { 'process.env.NODE_ENV': '"production"' },
    platform: 'browser',
    target: 'safari13',
    format: 'iife',
    write: false,
    plugins: [{
      name: 'inline-cardlink-ink-styles',
      setup(build) {
        build.onLoad({ filter: /[\\/](?:answer-ink|plugin-ink)\.css$/ }, async ({ path }) => ({
          contents: await readFile(path, 'utf8'), loader: 'text'
        }))
      }
    }]
  })
  const js = outputFiles.find(file => file.path.endsWith('.js'))
  const css = outputFiles.find(file => file.path.endsWith('.css'))
  const style = `(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(css.text)};document.head.append(style)})();`
  return (style + js.text).replace(/<\/script/gi, '<\\/script')
}
