// CSS 清理安全网：对完整 UI 预览页逐元素采集 getComputedStyle（含伪元素与
// 自定义属性），供改前/改后逐项比对，保证样式重构零渲染差异。
// 用法：
//   node scripts/css-baseline.mjs capture test-results/css-baseline/before.json
//   node scripts/css-baseline.mjs diff test-results/css-baseline/before.json test-results/css-baseline/after.json
import { chromium } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const [, , command, fileA, fileB] = process.argv

const PROPS = [
  "display", "position", "top", "right", "bottom", "left", "inset", "z-index",
  "flex-direction", "flex-wrap", "flex", "flex-grow", "flex-shrink", "flex-basis",
  "align-items", "align-self", "justify-content", "justify-items", "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-area", "grid-column", "grid-row",
  "overflow", "overflow-x", "overflow-y", "overscroll-behavior",
  "margin", "padding", "border", "border-radius", "border-color", "border-width", "border-style",
  "width", "height", "min-width", "max-width", "min-height", "max-height", "aspect-ratio", "box-sizing",
  "color", "background", "background-color", "background-image", "opacity", "visibility",
  "font", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
  "text-align", "text-decoration", "text-overflow", "text-shadow", "white-space", "word-break",
  "transform", "transform-origin", "transition", "animation", "animation-name",
  "box-shadow", "outline", "outline-offset", "cursor", "pointer-events", "touch-action",
  "filter", "backdrop-filter", "mix-blend-mode", "fill", "stroke", "content", "writing-mode"
]

const VIEWPORTS = [[900, 640], [700, 640], [460, 620]]
const TABS = ["overview", "mistakes", "review", "export", "settings"]

function previewUrl() {
  return pathToFileURL(path.resolve("ui-preview/CardLink-full-ui-preview.html")).href
}

async function openPage(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(previewUrl())
  await page.waitForSelector(".topNav", { timeout: 15000 })
  await page.waitForTimeout(400)
  return { context, page }
}

async function settle(page) {
  await page.waitForTimeout(250)
  try {
    await page.waitForFunction(() => !document.querySelector(".dataStreamStatus, .loading"), { timeout: 4000 })
  } catch { /* 某些状态本来就没有流式提示 */ }
  await page.waitForTimeout(150)
}

async function dumpVisible(page) {
  return page.evaluate(props => {
    function customProps(cs) {
      const list = []
      for (let i = 0; i < cs.length; i++) {
        const name = cs[i]
        if (name.startsWith("--")) list.push([name, cs.getPropertyValue(name).trim()])
      }
      return list
    }
    function pick(cs) {
      const record = {}
      for (const prop of props) record[prop] = cs.getPropertyValue(prop)
      return record
    }
    const out = []
    const rootCs = getComputedStyle(document.documentElement)
    out.push(["@root", pick(rootCs), customProps(rootCs)])
    const elements = [...document.querySelectorAll("*")]
    elements.forEach((el, index) => {
      const cs = getComputedStyle(el)
      const key = `${index}|${el.tagName.toLowerCase()}|${el.getAttribute("class") || ""}`
      out.push([key, pick(cs), customProps(cs)])
      for (const pseudo of ["::before", "::after"]) {
        const pcs = getComputedStyle(el, pseudo)
        const content = pcs.getPropertyValue("content")
        if (content && content !== "none" && content !== "normal") {
          out.push([`${key}${pseudo}`, pick(pcs), []])
        }
      }
    })
    return out
  }, PROPS)
}

async function capture(outFile) {
  // 优先用系统 Chrome（ms-playwright 缓存可能未安装浏览器）
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch())
  const snapshots = []
  for (const [width, height] of VIEWPORTS) {
    const { context, page } = await openPage(browser, width, height)
    const clickNav = async label => {
      await page.evaluate(name => {
        const buttons = [...document.querySelectorAll(".topNav button")]
        const target = buttons.find(button => button.textContent && button.textContent.includes(name))
        if (!target) throw new Error("找不到页签：" + name)
        target.click()
      }, label)
    }
    // 总览
    await clickNav("总览")
    await settle(page)
    snapshots.push({ viewport: [width, height], state: "overview", entries: await dumpVisible(page) })
    // 错题本：先采列表态，再选中一题展开详情 + 标签弹层
    await clickNav("错题本")
    await settle(page)
    snapshots.push({ viewport: [width, height], state: "mistakes-list", entries: await dumpVisible(page) })
    await page.click(".mistakeItem")
    await page.waitForSelector(".detailPane .detail", { timeout: 5000 })
    await page.waitForTimeout(500)
    // 460px 窄视口下收藏按钮会盖住标签触发钮，统一用事件派发直接打开弹层
    await page.evaluate(() => document.querySelector(".detailTagTrigger")?.click())
    await page.waitForTimeout(150)
    snapshots.push({ viewport: [width, height], state: "mistakes-detail", entries: await dumpVisible(page) })
    // 待复习：展开第一题的复测历史（蛇形时间轴 SVG）
    await clickNav("待复习")
    await settle(page)
    const historyButton = await page.$(".dueReviewActions button:has-text('复测历史')")
    if (historyButton) {
      await historyButton.click()
      await page.waitForTimeout(200)
    }
    snapshots.push({ viewport: [width, height], state: "review", entries: await dumpVisible(page) })
    // 设置
    await clickNav("设置")
    await settle(page)
    snapshots.push({ viewport: [width, height], state: "settings", entries: await dumpVisible(page) })
    // 导出页：只能从设置页入口进入
    await page.evaluate(() => {
      const target = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("导出错题") && button.closest(".settingsGroup"))
      if (!target) throw new Error("设置页里找不到导出入口")
      target.click()
    })
    await page.waitForSelector(".exportPage", { timeout: 5000 })
    await page.waitForTimeout(400)
    snapshots.push({ viewport: [width, height], state: "export", entries: await dumpVisible(page) })
    await context.close()
  }
  await browser.close()
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(snapshots))
  const elements = snapshots.reduce((sum, shot) => sum + shot.entries.length, 0)
  console.log(`captured ${snapshots.length} states, ${elements} element records -> ${outFile}`)
}

function compare(aFile, bFile, allowFile) {
  // allowFile：预期被消除的自定义属性名单（token 摊平的别名），名字消失不算差异
  const allowedRemoved = new Set(allowFile ? JSON.parse(fs.readFileSync(allowFile, "utf8")) : [])
  const a = JSON.parse(fs.readFileSync(aFile, "utf8"))
  const b = JSON.parse(fs.readFileSync(bFile, "utf8"))
  if (a.length !== b.length) throw new Error(`状态数不同：${a.length} vs ${b.length}`)
  const diffs = []
  for (let index = 0; index < a.length; index++) {
    const left = a[index], right = b[index]
    if (left.viewport.join() !== right.viewport.join() || left.state !== right.state) throw new Error(`状态 ${index} 顺序不一致`)
    const leftMap = new Map(left.entries.map(entry => [entry[0], entry]))
    const rightMap = new Map(right.entries.map(entry => [entry[0], entry]))
    for (const [key, entry] of leftMap) {
      const other = rightMap.get(key)
      if (!other) { diffs.push(`[${left.state}@${left.viewport}] 缺少元素 ${key}`); continue }
      const [, propsA, customsA] = entry
      const [, propsB, customsB] = other
      for (const prop of Object.keys(propsA)) {
        if (propsA[prop] !== propsB[prop]) diffs.push(`[${left.state}@${left.viewport}] ${key} ${prop}: "${propsA[prop]}" -> "${propsB[prop]}"`)
      }
      const mapB = new Map(customsB)
      for (const [name, value] of customsA) {
        if (allowedRemoved.has(name.replace(/^-+/, ""))) continue
        if (!mapB.has(name)) diffs.push(`[${left.state}@${left.viewport}] ${key} --${name} 丢失`)
        else if (mapB.get(name) !== value) diffs.push(`[${left.state}@${left.viewport}] ${key} ${name}: "${value}" -> "${mapB.get(name)}"`)
      }
      const mapA = new Map(customsA)
      for (const name of mapB.keys()) if (!mapA.has(name)) diffs.push(`[${left.state}@${left.viewport}] ${key} ${name} 新增`)
    }
    for (const key of rightMap.keys()) if (!leftMap.has(key)) diffs.push(`[${left.state}@${left.viewport}] 新增元素 ${key}`)
  }
  if (diffs.length) {
    console.log(`发现 ${diffs.length} 处差异：`)
    for (const line of diffs.slice(0, 80)) console.log("  " + line)
    if (diffs.length > 80) console.log(`  ...其余 ${diffs.length - 80} 处`)
    process.exitCode = 1
  } else {
    console.log("零差异：所有元素的计算样式、伪元素与自定义属性完全一致。")
  }
}

if (command === "capture") await capture(fileA)
else if (command === "diff") compare(fileA, fileB, process.argv[5])
else {
  console.error("用法：node scripts/css-baseline.mjs capture|diff <file> [fileB]")
  process.exit(1)
}
