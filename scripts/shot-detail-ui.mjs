// beta.65 错题详情 UI 重构预览截图：默认底部停靠 / 右侧竖向停靠 / 折叠圆点
import { chromium } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const outDir = process.argv[2] || "test-results/detail-ui-preview"
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch())

async function openDetail(page) {
  await page.goto(pathToFileURL(path.resolve("ui-preview/CardLink-full-ui-preview.html")).href)
  await page.waitForSelector(".topNav", { timeout: 15000 })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const target = [...document.querySelectorAll(".topNav button")].find(b => b.textContent?.includes("错题本"))
    target?.click()
  })
  await page.waitForTimeout(900)
  await page.click(".mistakeItem")
  await page.waitForSelector(".detailPane .detail", { timeout: 5000 })
  await page.waitForTimeout(600)
}

// 1) 默认：底部横向停靠
{
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  await openDetail(page)
  await page.locator(".detailPane .detail").screenshot({ path: path.join(outDir, "detail-bar-bottom.png") })
  await page.close()
}

// 2) 右侧竖向停靠 + 展开标签弹层
{
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  await page.addInitScript(() => localStorage.setItem("mn-detail-bar", JSON.stringify({ edge: "right", ratio: 0.66 })))
  await openDetail(page)
  await page.evaluate(() => document.querySelector(".detailTagBarTrigger")?.click())
  await page.waitForTimeout(250)
  await page.locator(".detailPane .detail").screenshot({ path: path.join(outDir, "detail-bar-right-tags.png") })
  await page.close()
}

// 3) 折叠为圆点
{
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  await openDetail(page)
  await page.evaluate(() => document.querySelector(".detailBarCollapse")?.click())
  await page.waitForTimeout(250)
  await page.locator(".detailPane .detail").screenshot({ path: path.join(outDir, "detail-bar-dot.png") })
  await page.close()
}

// 4) 多答案记录：答案页签出现变体选择控件
{
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  await openDetail(page)
  await page.evaluate(() => {
    const target = [...document.querySelectorAll(".detailActionBar > button")].find(b => b.textContent?.includes("答案"))
    target?.click()
  })
  await page.waitForTimeout(600)
  const hasSelect = await page.$(".detailActionBar .answerVariantSelect")
  if (!hasSelect) throw new Error("多答案选择控件未出现，请检查预览 mock 的双答案记录")
  await page.locator(".detailPane .detail").screenshot({ path: path.join(outDir, "detail-bar-multi-answer.png") })
  await page.close()
}

await browser.close()
console.log("saved:", fs.readdirSync(outDir).join(", "))
