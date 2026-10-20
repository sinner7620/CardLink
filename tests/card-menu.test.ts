import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { runCardMenuCommand, type CardMenuDependencies } from "../src/card-menu"

function harness(){
  let notebook="book-a", selection="other-card", picked:0|1|2|undefined=1
  const writes:any[]=[],lookups:any[]=[]
  const deps:CardMenuDependencies={
    resolve:noteID=>({noteID,notebookID:notebook}),notebookID:()=>notebook,
    findAnswer:async target=>{lookups.push(target)},currentLevel:()=>2,
    chooseLevel:async current=>{assert.equal(current,2);selection="new-selection";return picked},
    mark:async(target,level)=>{writes.push({target,level})}
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
test("取消等级选择不写入；选择期间切换学习集中止",async()=>{
  const cancelled=harness();cancelled.cancel()
  assert.deepEqual(await runCardMenuCommand("markMistake","card",cancelled.deps),{cancelled:true})
  assert.equal(cancelled.writes.length,0)
  const changed=harness();changed.deps.chooseLevel=async()=>{changed.setNotebook("book-b");return 0}
  await assert.rejects(runCardMenuCommand("markMistake","card",changed.deps),/学习集已切换/)
  assert.equal(changed.writes.length,0)
})
test("缺失卡片ID或未知命令不能进入写入流程",async()=>{
  const h=harness()
  await assert.rejects(runCardMenuCommand("markMistake","",h.deps),/卡片ID/)
  await assert.rejects(runCardMenuCommand("unknown" as any,"card",h.deps),/未知/)
  assert.equal(h.writes.length,0)
})
test("早于页面加载的菜单事件缓冲，重复点击去重，等级弹层串行",async()=>{
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
  assert.equal(closed,1);assert.equal(logs[0][1].event,"cardMenu.invalidTarget")
})

test("菜单业务失败保留错误界面，不自动收起掩盖错误",async()=>{
  const scope:any={Promise};runInNewContext(readFileSync("web/card-menu.js","utf8"),scope)
  let handler:any,closed=0
  scope.CardLinkCardMenu.install({on(_name:string,fn:any){handler=fn}})
  scope.CardLinkCardMenu.listen(async()=>{throw Error("failed")},()=>closed++)
  handler({id:"markMistake",noteid:"card"});await new Promise(resolve=>setImmediate(resolve))
  assert.equal(closed,0)
})
