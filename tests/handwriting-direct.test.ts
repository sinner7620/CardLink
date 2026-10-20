import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

test("直接手写桥接只返回详情原题身份，不定位、不聚焦、不切换学习集", async () => {
  const source = readFileSync("src/rails-core.ts", "utf8")
  const branch = source.match(/if \(command === "openMistakeHandwriting"\) \{[\s\S]*?\n  \}/)?.[0]
  assert.ok(branch)
  const target = { recordId: "r", noteid: "question", topicid: "other-study-set" }
  let enabled = true, lookups = 0
  const run = runInNewContext(`(async function(payload) { const command = "openMistakeHandwriting", owner = {}; ${branch} })`, {
    mistakeHandwritingTarget: (id: string) => { assert.equal(id, "r"); lookups++; return target },
    sceneFeatures: () => ({ handwriting: enabled }),
    MN: { currnetNotebookId: "current", app: { openURL() { assert.fail("不得切换学习集") } } },
    openSourceByMistakeId() { assert.fail("不得定位原卡片") }
  })
  assert.equal(await run({ recordId: "r" }), target)
  enabled = false
  await assert.rejects(run({ recordId: "r" }), /4.5.0/)
  assert.equal(lookups, 2)
})
