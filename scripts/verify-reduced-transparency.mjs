// P1 验证工具：模拟 prefers-reduced-transparency，检查毛玻璃面是否降级为纯色。
// 用法：node scripts/verify-reduced-transparency.mjs [screenshot-prefix]
import { chromium } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const prefix = process.argv[2] || "rtransparency"
const previewUrl = pathToFileURL(path.resolve("ui-preview/CardLink-full-ui-preview.html")).href

const CASES = [
  { state: "mistakes-list", nav: "错题本", targets: ["header.topBar", ".mistakeSearchGlass"] },
  { state: "review", nav: "待复习", targets: [".settingsCapsule.reviewToolbar"] },
  { state: "settings", nav: "设置", targets: [".settingsCapsule:not(.reviewToolbar)"] }
]
// 允许的纯色底：#fbfbfd(本修复) / #f6f6f8(mistakeSearchGlass) / #f3f4f5(reviewToolbar)
// / #f4f7fc(settingsCapsule, sticky-toolbars) / #fff

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch())
const context = await browser.newContext({ viewport: { width: 900, height: 640 } })
const page = await context.newPage()
// Playwright 1.62 不支持 reducedTransparency 选项，直接走 CDP 注入媒体特性
const cdp = await context.newCDPSession(page)
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] })
await page.goto(previewUrl)
await page.waitForSelector(".topNav", { timeout: 15000 })
await page.waitForTimeout(600)

let failures = 0
const outDir = "test-results/reduced-transparency"
fs.mkdirSync(outDir, { recursive: true })
for (const item of CASES) {
  await page.evaluate(name => {
    const target = [...document.querySelectorAll(".topNav button")].find(button => button.textContent?.includes(name))
    if (!target) throw new Error("找不到页签 " + name)
    target.click()
  }, item.nav)
  await page.waitForTimeout(700)
  for (const selector of item.targets) {
    const probe = await page.evaluate(selector => {
      const el = document.querySelector(selector)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { backdrop: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor }
    }, selector)
    if (!probe) { console.log(`FAIL ${item.state} ${selector}: 元素不存在`); failures++; continue }
    const blurOff = probe.backdrop === "none" || probe.backdrop === ""
    const solid = ["rgb(251, 251, 253)", "rgb(243, 244, 245)", "rgb(244, 247, 252)", "rgb(246, 246, 248)", "rgb(255, 255, 255)"].includes(probe.bg)
    console.log(`${blurOff && solid ? "PASS" : "FAIL"} ${item.state} ${selector}: backdrop=${probe.backdrop || "none"} bg=${probe.bg}`)
    if (!blurOff || !solid) failures++
  }
  await page.screenshot({ path: `${outDir}/${prefix}-${item.state}.png` })
}
await browser.close()
console.log(failures ? `FAILED: ${failures} 项未通过` : "ALL PASS")
process.exit(failures ? 1 : 0)
