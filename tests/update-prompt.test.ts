import assert from "node:assert/strict"
import test from "node:test"
import { normalizeUpdatePrompt } from "../src/update-prompt"

const payload = {
  version: "9.9.9",
  channel: "正式版",
  source: "GitHub",
  currentVersion: "2.4.8-b80",
  notes: "更新说明",
  promptId: "update-1"
}

test("更新提示只显示带版本的载荷，关闭信号不会显示空壳弹窗", () => {
  assert.deepEqual(normalizeUpdatePrompt(payload, null), payload)
  for (const closing of [null, undefined, {}, "", 0, { promptId: "update-1" }, { promptId: "update-1", close: true }]) {
    assert.equal(normalizeUpdatePrompt(closing, payload), null, `关闭载荷 ${JSON.stringify(closing)} 不应显示弹窗`)
  }
})

test("关闭信号只关闭同一身份的提示，旧请求不能关闭新提示", () => {
  const current = { ...payload, promptId: "update-2" }
  assert.equal(normalizeUpdatePrompt({ promptId: "update-1", close: true }, current), current)
  assert.equal(normalizeUpdatePrompt({ promptId: "update-1" }, current), current)
  // 不带身份的关闭（旧原生版本直接推 null）仍然关闭当前提示。
  assert.equal(normalizeUpdatePrompt(null, current), null)
  // 新提示覆盖旧提示。
  const next = { ...payload, promptId: "update-3", version: "9.9.10" }
  assert.deepEqual(normalizeUpdatePrompt(next, current), next)
})

test("原 Markdown 与纯文本摘要并存：面板拿得到原文，旧载荷仍按纯文本回退", async () => {
  const { normalizeUpdatePrompt } = await import("../src/update-prompt")
  const withMarkdown = {
    version: "9.9.9", channel: "正式版", source: "GitHub", currentVersion: "2.4.8-b84",
    notes: "纯文本摘要", notesMarkdown: "## 更新\n\n- **加粗**\n", promptId: "update-7"
  }
  const accepted = normalizeUpdatePrompt(withMarkdown, null)
  assert.equal(accepted?.notesMarkdown, "## 更新\n\n- **加粗**\n")
  assert.equal(accepted?.notes, "纯文本摘要")
  // 旧原生版本只带纯文本：不因缺少 notesMarkdown 被当成关闭信号。
  const legacy = normalizeUpdatePrompt({ version: "9.9.8", channel: "正式版", source: "GitHub", currentVersion: "2.4.8-b84", notes: "只有摘要" }, null)
  assert.equal(legacy?.version, "9.9.8")
  assert.equal(legacy?.notesMarkdown, undefined)
})
