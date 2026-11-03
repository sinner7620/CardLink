// Rasterize the retained SF Symbols vectors. Runtime only loads native UIImage;
// see web/src/sf/review/README.md for symbol names and upstream provenance.
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const directory = new URL('../assets/review-toolbar/', import.meta.url)
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chromium' })
try {
  const page = await browser.newPage()
  const drawings = [
    ['previous', 'chevron.backward', 14], ['forward', 'chevron.forward', 14], ['next', 'checkmark', 18],
    ['history', 'clock.arrow.trianglehead.counterclockwise.rotate.90', 20], ['answer', 'magnifyingglass', 19], ['category', 'list.bullet', 20],
    ['collapse', 'sidebar.left', 20], ['mark', 'flag', 20], ['exit', 'rectangle.portrait.and.arrow.right', 20]
  ]
  for (const [key, symbol, size] of drawings) {
    const svg = (await readFile(new URL(`../web/src/sf/review/${symbol}.svg`, import.meta.url), 'utf8'))
      .replaceAll('#000000', '#172033').replaceAll('currentColor', '#172033').replaceAll('fill-opacity="0.85"', 'fill-opacity="1"')
    const [, width, height] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    const drawing = { key, size, svg, width: Number(width), height: Number(height) }
    const base64 = await page.evaluate(async ({ svg, size, width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 60
      const source = new Image()
      source.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await source.decode()
      const scale = size * 3 / Math.max(width, height)
      const w = width * scale, h = height * scale
      canvas.getContext('2d').drawImage(source, (60 - w) / 2, (60 - h) / 2, w, h)
      return canvas.toDataURL('image/png').split(',')[1]
    }, drawing)
    await writeFile(new URL(`${drawing.key}.png`, directory), Buffer.from(base64, 'base64'))
  }
} finally { await browser.close() }
