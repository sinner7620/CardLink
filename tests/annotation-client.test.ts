import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

function client(api: (path: string, options?: any) => Promise<any>) {
  const scope: any = { setTimeout, clearTimeout }
  runInNewContext(readFileSync("web/annotation-client.js", "utf8"), scope)
  return scope.createCardLinkAnnotationClient({ api })
}

test("直接批注按题卡ID读取新鲜版本，不传练习上下文，不把打开当成保存", async () => {
  const calls: any[] = []
  const c = client(async (path, options) => {
    calls.push({ path, options })
    return options ? { editorOpened: true, persisted: false } : { revision: "fresh", comments: [] }
  })
  const result = await c.open("question")
  assert.equal(result.persisted, false)
  assert.equal(calls[0].path, "/notes/question/comments")
  assert.equal(calls[1].path, "/notes/question/annotation-editor")
  assert.equal(calls[1].options.body.expectedRevision, "fresh")
  assert.equal("practice" in calls[1].options.body, false)
  assert.equal("commentId" in calls[1].options.body, false)
  assert.equal("addon" in calls[1].options.body, false)
})

test("直接批注不指定历史作答纸，仍使用当前批注版本", async () => {
  let body: any
  const c = client(async (_path, options) => {
    if (!options) return { revision: "new", comments: [{ commentId: "paper", type: "practice" }] }
    body = options.body
    return { editorOpened: true, continued: true }
  })
  await c.open("q")
  assert.equal("commentId" in body, false)
  assert.equal(body.confirm, true)
  assert.equal(body.expectedRevision, "new")
})

test("只有普通批注时仍由宿主打开作答编辑器，不自行判断历史纸张", async () => {
  let writes = 0
  const c = client(async (_path, options) => {
    if (options) writes++
    return options ? { editorOpened: true } : { revision: "r", comments: [{ commentId: "text", type: "text" }] }
  })
  await c.open("q")
  assert.equal(writes, 1)
})

test("缺少版本或题卡身份阻止打开，宿主拒绝不自动重试", async () => {
  const missing = client(async () => ({ comments: [] }))
  await assert.rejects(missing.open("q"), /版本/)
  await assert.rejects(missing.open(""), /题卡身份/)
  let writes = 0
  const refused = client(async (_path, options) => {
    if (!options) return { revision: "r" }
    writes++
    return { error: { code: "ANNOTATION_UNAVAILABLE", message: "编辑器占用" } }
  })
  await assert.rejects(refused.open("q"), /编辑器占用/)
  assert.equal(writes, 1)
})

test("宿主未确认打开不能显示成功", async () => {
  const c = client(async (_path, options) => options ? { persisted: false } : { revision: "r" })
  await assert.rejects(c.open("q"), /未确认/)
})

test("读取版本后离开场景，写前检查阻止打开编辑器", async () => {
  let writes = 0
  const c = client(async (_path, options) => {
    if (options) writes++
    return options ? { editorOpened: true } : { revision: "r" }
  })
  await assert.rejects(c.open("q", async () => { throw new Error("已离开场景") }), /已离开场景/)
  assert.equal(writes, 0)
})
