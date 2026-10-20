import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {transpileModule} from 'typescript'

function fixture(fail = false) {
  const calls: any[] = [], root: any = {hidden:false}, body: any = {children:[], appendChild(child: any){this.children.push(child)}}
  const element = () => ({style:{cssText:''},children:[] as any[],textContent:'',remove(){this.children=[]},setAttribute(){},replaceChildren(){this.children=[]},appendChild(child:any){this.children.push(child)}})
  let handle: any, idle: any, resolveReady!:()=>void
  const ready = new Promise<void>(resolve=>{resolveReady=resolve})
  const sdk = {mode:(value:string)=>calls.push(['mode',value]),size:(w:number,h:number)=>calls.push(['size',w,h]),call:async(name:string)=>calls.push(['call',name])}
  const window: any = {fetch(){},CardLinkHostPolicy:{},CardLinkCardMenu:{listen(handler:any,onIdle:any){handle=handler;idle=onIdle}}}
  runInNewContext(transpileModule(readFileSync('web/card-command-surface.js','utf8'),{compilerOptions:{module:1,target:7}}).outputText,{
    window,document:{body,getElementById:()=>root,createElement:element},exports:{},require:()=>({createSceneTransport:()=>({send:async(command:string,payload:any)=>{calls.push(['send',command,payload]);if(fail)throw Error('业务失败')}})})
  })
  const surface=window.CardLinkCommandSurface.install(sdk,ready)
  return {calls,root,body,surface,window,resolveReady,handle:(payload:any)=>handle(payload),idle:()=>idle()}
}

test('菜单事件立即转为小面板，等待场景确认才执行，完成时关闭且不改工作台保存尺寸',async()=>{
  const f=fixture(),payload={id:'findAnswer',noteID:'event-note'}
  assert.equal(f.surface.active(),false)
  const pending=f.handle(payload)
  assert.equal(f.surface.active(),true);assert.equal(f.root.hidden,true)
  assert.deepEqual(f.calls,[['mode','mini'],['size',240,64]])
  f.resolveReady();await pending;await f.idle()
  assert.deepEqual(f.calls.slice(2),[['call','sceneCommandReady'],['send','cardMenuCommand',payload],['call','sceneClose']])
})

test('命令失败保留小型错误窗口，关闭按钮调用公开关闭命令',async()=>{
  const f=fixture(true);f.resolveReady()
  await assert.rejects(f.handle({id:'markMistake',noteID:'event-note'}),/业务失败/)
  const children=f.body.children[0].children
  assert.equal(children[0].textContent,'业务失败');assert.equal(children[1].textContent,'关闭')
  assert.deepEqual(f.calls[f.calls.length - 1],['size',240,100])
  await children[1].onclick()
  assert.deepEqual(f.calls[f.calls.length - 1],['call','sceneClose'])
})


test('主工作台打开时菜单命令不缩小隐藏或关闭工作台；mini宿主可恢复正常页面',async()=>{
 const f=fixture();f.window.__MN_WORKBENCH_MOUNTING__=true;f.resolveReady()
 await f.handle({id:'markMistake',noteID:'event-note'});await f.idle()
 assert.equal(f.root.hidden,false);assert.equal(f.surface.active(),false)
 assert.equal(f.calls.some(c=>c[0]==='mode'||c[0]==='size'||(c[0]==='call'&&c[1]==='sceneClose')),false)
 const mini=fixture();mini.resolveReady();await mini.handle({id:'findAnswer',noteID:'event-note'})
 assert.equal(mini.root.hidden,true)
 mini.surface.restoreWorkbench();mini.window.__MN_WORKBENCH_MOUNTING__=true;await mini.idle()
 assert.equal(mini.root.hidden,false);assert.equal(mini.surface.active(),false)
 assert.equal(mini.calls.some(c=>c[0]==='call'&&c[1]==='sceneClose'),false)
})
