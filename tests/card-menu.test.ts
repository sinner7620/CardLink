import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { runCardMenuCommand, type CardMenuDependencies } from "../src/card-menu"

test('卡片命令立即保存等级，接着补写同一次错因；掌握只保存等级', async () => {
  const h = harness(), feedbacks: any[] = [], supplements: any[] = []
  let submit!: Parameters<CardMenuDependencies['showFeedback']>[2], finish!: (value: {}) => void
  h.deps.showFeedback = async (_target, _level, callback) => {
    submit = callback
    return new Promise(resolve => { finish = resolve })
  }
  h.deps.mark = async (target, feedback) => {
    feedbacks.push({ target, feedback })
    return { recordId: `${target.notebookID}:${target.noteID}`, historyId: `history-${feedbacks.length}`, level: feedback.level }
  }
  h.deps.supplementReason = async (target, reason, receipt) => { supplements.push({ target, reason, receipt }) }
  let completed = false
  const command = runCardMenuCommand('markMistake', 'event-card', h.deps).then(value => { completed = true; return value })
  await Promise.resolve()
  assert.equal(feedbacks.length, 0)
  assert.equal(completed, false)
  await submit({ level: 1 })
  await submit({ level: 1, reason: { key: 'reading', label: '审题遗漏' } })
  assert.deepEqual(feedbacks, [{ target: { noteID: 'event-card', notebookID: 'book-a' }, feedback: { level: 1 } }])
  assert.deepEqual(supplements, [{ target: { noteID: 'event-card', notebookID: 'book-a' }, reason: { key: 'reading', label: '审题遗漏' },
    receipt: { recordId: 'book-a:event-card', historyId: 'history-1', level: 1 } }])
  assert.equal(completed, false)
  await submit({ level: 2, reason: { key: 'time', label: '时间不足' } })
  assert.deepEqual(feedbacks[1].feedback, { level: 2 })
  assert.equal(supplements.length, 1)
  finish({})
  assert.deepEqual(await command, {})
})

test('保存失败后命令继续等待同页重试，无效等级不能写入', async () => {
  const h = harness()
  let calls = 0
  h.deps.mark = async (target, feedback) => {
    if (++calls === 1) throw Error('标签写入失败')
    return { recordId: `${target.notebookID}:${target.noteID}`, historyId: 'retry-history', level: feedback.level }
  }
  h.deps.showFeedback = async (_target, _level, submit) => {
    await assert.rejects(submit({ level: 3 as any }), /有效的掌握等级/)
    assert.equal(calls, 0)
    await assert.rejects(submit({ level: 0 }), /标签写入失败/)
    await assert.rejects(submit({ level: 0, reason: { key: 'concept', label: '概念不清' } }), /先成功保存/)
    await submit({ level: 0 })
    await submit({ level: 0, reason: { key: 'concept', label: '概念不清' } })
    return {}
  }
  assert.deepEqual(await runCardMenuCommand('markMistake', 'event-card', h.deps), {})
  assert.equal(calls, 2)
})

test('补写失败保留回执可重试，改等级或重开菜单不能复用回执', async () => {
  const h = harness(), receipts: any[] = []
  let attempts = 0
  h.deps.supplementReason = async (_target, _reason, receipt) => {
    receipts.push(receipt)
    if (++attempts === 1) throw Error('错因标签写入失败')
  }
  h.deps.showFeedback = async (_target, _level, submit) => {
    const reason = { key: 'reading', label: '审题遗漏' }
    await assert.rejects(submit({ level: 1, reason }), /先成功保存/)
    await submit({ level: 1 })
    await assert.rejects(submit({ level: 1, reason }), /错因标签/)
    await submit({ level: 1, reason })
    assert.deepEqual(receipts[1], receipts[0])
    await assert.rejects(submit({ level: 0, reason }), /先成功保存/)
    await submit({ level: 0 })
    await submit({ level: 0, reason })
    assert.equal(receipts[2].historyId, 'history-2')
    return {}
  }
  await runCardMenuCommand('markMistake', 'event-card', h.deps)
  assert.equal(h.writes.length, 2)
  h.deps.showFeedback = async (_target, _level, submit) => {
    await assert.rejects(submit({ level: 0, reason: { key: 'time', label: '时间不足' } }), /先成功保存/)
    return { cancelled: true }
  }
  await runCardMenuCommand('markMistake', 'event-card', h.deps)
  assert.equal(attempts, 3)
})

test('未保存或跨题回执不能补写，失败的新等级保存废弃旧回执', async () => {
  const h = harness()
  let marks = 0, supplements = 0
  h.deps.mark = async (target, feedback) => {
    marks++
    if (marks === 1) return undefined
    if (marks === 2) return { recordId: 'book-a:other-card', historyId: 'wrong-target', level: feedback.level }
    if (marks === 4) throw Error('等级写入失败')
    return { recordId: `${target.notebookID}:${target.noteID}`, historyId: 'saved-history', level: feedback.level }
  }
  h.deps.supplementReason = async () => { supplements++ }
  h.deps.showFeedback = async (_target, _level, submit) => {
    const reason = { key: 'reading', label: '审题遗漏' }
    await assert.rejects(submit({ level: 1 }), /等级未能保存/)
    await assert.rejects(submit({ level: 1, reason }), /先成功保存/)
    await assert.rejects(submit({ level: 1 }), /回执与目标卡片不一致/)
    await assert.rejects(submit({ level: 1, reason }), /先成功保存/)
    await submit({ level: 1 })
    await assert.rejects(submit({ level: 0 }), /等级写入失败/)
    await assert.rejects(submit({ level: 1, reason }), /先成功保存/)
    return {}
  }
  await runCardMenuCommand('markMistake', 'event-card', h.deps)
  assert.equal(marks, 4)
  assert.equal(supplements, 0)
})

function harness(){
  let notebook="book-a", selection="other-card", picked:0|1|2|undefined=1
  const writes:any[]=[],lookups:any[]=[]
  const deps:CardMenuDependencies={
    resolve:noteID=>({noteID,notebookID:notebook}),notebookID:()=>notebook,
    findAnswer:async target=>{lookups.push(target)},currentLevel:()=>2,
    showFeedback:async (_target,current,submit)=>{assert.equal(current,2);selection="new-selection";if(picked===undefined)return {cancelled:true};await submit({level:picked});return {}},
    mark:async(target,feedback)=>{writes.push({target,level:feedback.level});return {recordId:`${target.notebookID}:${target.noteID}`,historyId:`history-${writes.length}`,level:feedback.level}},
    supplementReason:async()=>{}
  }
  return{deps,writes,lookups,setNotebook:(value:string)=>notebook=value,cancel:()=>picked=undefined,get selection(){return selection}}
}
test("卡片菜单查答案使用事件卡片，标记选择后仍写入原题",async()=>{
  const h=harness()
  await runCardMenuCommand("findAnswer","event-card",h.deps)
  assert.equal(h.lookups[0].noteID,"event-card")
  await runCardMenuCommand("markMistake","event-card",h.deps)
  assert.equal(h.selection,"new-selection")
  assert.deepEqual(h.writes,[{target:{noteID:"event-card",notebookID:"book-a"},level:1}])
})
test("取消反馈页不写入；选择期间切换学习集中止",async()=>{
  const cancelled=harness();cancelled.cancel()
  assert.deepEqual(await runCardMenuCommand("markMistake","card",cancelled.deps),{cancelled:true})
  assert.equal(cancelled.writes.length,0)
  const changed=harness();changed.deps.showFeedback=async(_target,_current,submit)=>{changed.setNotebook("book-b");await submit({level:0});return {}}
  await assert.rejects(runCardMenuCommand("markMistake","card",changed.deps),/学习集已切换/)
  assert.equal(changed.writes.length,0)
})
test("缺失卡片ID或未知命令不能进入写入流程",async()=>{
  const h=harness()
  await assert.rejects(runCardMenuCommand("markMistake","",h.deps),/卡片ID/)
  await assert.rejects(runCardMenuCommand("unknown" as any,"card",h.deps),/未知/)
  assert.equal(h.writes.length,0)
})
test("早于页面加载的菜单事件缓冲，重复点击去重，反馈页串行",async()=>{
  const scope:any={Promise};runInNewContext(readFileSync("web/card-menu.js","utf8"),scope)
  let handler:any,register=0
  const sdk={on(_name:string,fn:any){handler=fn;register++}}
  scope.CardLinkCardMenu.install(sdk);scope.CardLinkCardMenu.install(sdk)
  handler({id:"markMistake",noteID:"a"});handler({id:"markMistake",noteID:"a"});handler({id:"findAnswer",noteID:"b"})
  const events:string[]=[];let release!:()=>void
  scope.CardLinkCardMenu.listen(async(event:any)=>{events.push(event.noteID);if(event.noteID==="a")await new Promise<void>(resolve=>release=resolve)})
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,["a"])
  release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,["a","b"]);assert.equal(register,1)
})
test("菜单兼容参考插件noteid与文档noteID；冲突身份拒绝，完成后只收起一次",async()=>{
  const scope:any={Promise};runInNewContext(readFileSync("web/card-menu.js","utf8"),scope)
  let handler:any,closed=0;const logs:any[]=[]
  scope.CardLinkCardMenu.install({on(_name:string,fn:any){handler=fn},call(...args:any[]){logs.push(args);return Promise.resolve()}})
  const calls:any[]=[]
  scope.CardLinkCardMenu.listen(async(event:any)=>{calls.push(event)},()=>{closed++})
  handler({id:"findAnswer",noteid:"lower-card"})
  handler({id:"markMistake",noteID:"upper-card"})
  handler({id:"markMistake",noteid:"a",noteID:"b"})
  await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(calls.map(c=>c.noteID),["lower-card","upper-card"])
  assert.equal(closed,1);assert.ok(logs.some(log=>log[1].event === "cardMenu.invalidTarget"))
  assert.ok(logs.some(log=>log[1].event === 'cardMenu.received' && log[1].detail.includes('keys=id,noteID')))
})

test("菜单业务失败保留错误界面，不自动收起掩盖错误",async()=>{
  const scope:any={Promise};runInNewContext(readFileSync("web/card-menu.js","utf8"),scope)
  let handler:any,closed=0
  scope.CardLinkCardMenu.install({on(_name:string,fn:any){handler=fn}})
  scope.CardLinkCardMenu.listen(async()=>{throw Error("failed")},()=>closed++)
  handler({id:"markMistake",noteid:"card"});await new Promise(resolve=>setImmediate(resolve))
  assert.equal(closed,0)
})
