import { test, expect } from "@playwright/test"

const widths = [500, 920]
const tabs = [
  ["总览", "overview"],
  ["错题本", "mistakes"],
  ["待复习", "review"],
  ["设置", "settings"]
]

test.use({ channel: "msedge", viewport: { width: 920, height: 900 } })

for (const width of widths) {
  test(`阶段二界面基线 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("http://127.0.0.1:5173")
    await expect(page.locator(".topBar")).toBeVisible()
    for (const [label, name] of tabs) {
      await page.getByRole("button", { name: new RegExp(`^${label}`) }).click()
      await page.waitForTimeout(120)
      await page.screenshot({ path: `output/playwright/stage2-${name}-${width}.png`, fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    }
  })
}

test("复测时间轴超宽后蛇形换行且不产生横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 900 })
  await page.goto("http://127.0.0.1:5173")
  await page.getByRole("button", { name: /^待复习/ }).click()
  await page.getByRole("button", { name: /^已逾期/ }).click()
  await page.getByRole("button", { name: /^复测历史/ }).first().click()
  const timeline = page.locator('.reviewHistory ol[aria-label="复测历史蛇形时间轴"]').first()
  await expect(timeline).toBeVisible()
  const metrics = await timeline.evaluate(list => {
    const nodes = [...list.querySelectorAll("li")].map(item => ({ left: item.offsetLeft, top: item.offsetTop }))
    const rows = [...new Set(nodes.map(item => item.top))].map(top => nodes.filter(item => item.top === top))
    return {
      rows,
      scrollWidth: list.scrollWidth,
      clientWidth: list.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      markerEnd: list.querySelector(".reviewTimelinePath > path")?.getAttribute("marker-end") || ""
    }
  })
  expect(metrics.rows.length).toBeGreaterThan(1)
  expect(metrics.rows[0][0].left).toBeLessThan(metrics.rows[0].at(-1).left)
  expect(metrics.rows[1][0].left).toBeGreaterThan(metrics.rows[1].at(-1).left)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.pageOverflow).toBeLessThanOrEqual(1)
  expect(metrics.markerEnd).toContain("review-timeline-arrow")
  await expect(timeline).toHaveCSS("touch-action", "pan-y")
  await page.screenshot({ path: "output/playwright/beta61-serpentine-500.png", fullPage: true })
})
