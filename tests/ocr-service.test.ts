import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { OCRStore } from '../src/ocr-store'

let store:OCRStore, records:Record<string,any>={}, notes:Record<string,any>={}, requests=0
let resolveRequest:((value:any)=>void)|undefined
const preferencesKV:Record<string,any>={}
const backupFiles=new Map<string,any>();let selectedBackup:string|undefined,savePanels=0,providerFailure=''
let delayed=false
const config={engine:'glm-ocr',model:'glm-ocr',optionsHash:'options',baseUrl:'https://ocr.test'}
mock.module('../src/storage-paths',{namedExports:{ensureStorageDirectory:()=>true}})
mock.module('../src/note-navigation',{namedExports:{recordRuntimeState:()=>{}}})
mock.module('marginnote',{namedExports:{MN:{app:{openFileWithUTIs:(_types:any,_controller:any,callback:any)=>setTimeout(()=>callback(selectedBackup),0)},db:{getNoteById:(id:string)=>notes[id],getMediaByHash:()=>null}},getLocalDataByKey:(key:string)=>preferencesKV[key],setLocalDataByKey:(value:any,key:string)=>{preferencesKV[key]=value},openFile:async()=>undefined,readJSON:(path:string)=>backupFiles.get(path),writeTextFile:(path:string,value:string)=>backupFiles.set(path,JSON.parse(value)),saveFile:()=>{savePanels++},delay:()=>new Promise(r=>setTimeout(r,0)),isNSNull:(value:any)=>value?.nativeNull===true}})
mock.module('../src/mistake-store',{namedExports:{loadMistakeState:()=>({records})}})
mock.module('../src/card-html',{namedExports:{renderCardHtml:(note:any,_title:any,_lookup:any,_media:any,_drawing:any,_collapse:any,children:boolean,_runtime:any,options:any)=>{
  assert.equal(children,false);assert.equal(options.handwriting,false);assert.equal(options.comments,false)
  return `<html><body><article>${note.body}</article></body></html>`
}}})
mock.module('../src/ocr-native',{namedExports:{ocrStore:()=>store,ocrRoot:()=>'/ocr',diagnoseOCR:()=>({ok:true})}})
class ProviderError extends Error{constructor(readonly kind='network',readonly uncertain=false){super(kind)}}
mock.module('../src/ocr-provider',{namedExports:{OCRProviderError:ProviderError,OCRPausedError:class extends Error{},providerConfig:()=>config,checkCredential:()=>true,recognizeAsset:async(_config:any,_data:any,_remote:any,hooks:any)=>{
  requests++;hooks.stage('uploading')
  if(providerFailure)throw new ProviderError(providerFailure,providerFailure==='network')
  if(delayed)return new Promise(resolve=>{resolveRequest=resolve})
  hooks.stage('normalizing');return{markdown:'正定矩阵识别结果',blocks:'[]'}
}}})
let bridge:typeof import('../src/ocr-service').ocrBridge
async function reset(){
  bridge||=(await import('../src/ocr-service')).ocrBridge
  const raw=new DatabaseSync(':memory:')
  store=new OCRStore({exec:(sql,args=[])=>{raw.prepare(sql).run(...args)},rows:(sql,args=[])=>raw.prepare(sql).all(...args),close:()=>raw.close()})
  records={q:{recordId:'q',sourceNotebookId:'n',sourceNoteId:'note',sourceTitle:'题目',categoryPath:['数学']}}
  notes={note:{body:'<img src="data:image/jpeg;base64,aW1hZ2U=" />'}};requests=0;delayed=false;resolveRequest=undefined
  for(const key of Object.keys(preferencesKV))delete preferencesKV[key]
  providerFailure='';backupFiles.clear();selectedBackup=undefined;savePanels=0
  await bridge('ocrDbResume')
}
async function until(predicate:()=>Promise<boolean>){for(let i=0;i<200;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,2))}throw Error('timed out')}
async function sync(){await bridge('ocrDbSync',{consent:true});await until(async()=>!(await bridge('ocrDbGetStats')).sync.running)}
async function capture(){const q=await bridge('ocrDbNext');assert.ok(q.html);await bridge('ocrDbSubmitImages',{jobId:q.jobId,lease:q.lease,images:['data:image/jpeg;base64,aW1hZ2U=']})}

test('renders an unsaved OCR draft before opening the database', async () => {
  const { ocrBridge } = await import('../src/ocr-service')
  const { html } = await ocrBridge('ocrDbRenderPreview', { text: '设 $A$ 为矩阵。<img src=x onerror=alert(1)>' })
  assert.match(html, /<math\b/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<img\b/)
  await assert.rejects(ocrBridge('ocrDbRenderPreview', { text: 'x'.repeat(500001) }), /预览正文过长/)
})

test('new database pipeline reads native text without OCR and never imports old caches',async()=>{
  await reset();notes.note.body='<p>相似矩阵原生题干</p>'
  await sync();assert.equal((await bridge('ocrDbGetQuestion',{recordId:'q'})).status,'not_needed')
  assert.equal((await bridge('ocrDbNext')).idle,true);assert.equal(requests,0)
  assert.equal((await bridge('ocrDbSearch',{query:'相似矩阵'})).total,1);store.db.close()
})
test('image preparation, recognition, ten repeat syncs and grade-only edits send one request',async()=>{
  await reset();await sync();await capture();await bridge('ocrDbNext')
  await until(async()=>!(await bridge('ocrDbGetStats')).running)
  assert.equal((await bridge('ocrDbGetQuestion',{recordId:'q'})).status,'ready')
  for(let i=0;i<10;i++){records.q.level=i%3;await sync();await bridge('ocrDbNext')}
  assert.equal(requests,1);store.db.close()
})
test('changed source before upload is stale without automatically authorizing a new image',async()=>{
  await reset();await sync();const capture=await bridge('ocrDbNext');notes.note.body+='<p>新题干</p>'
  await assert.rejects(bridge('ocrDbSubmitImages',{jobId:capture.jobId,lease:capture.lease,images:['data:image/jpeg;base64,aW1hZ2U=']}),/题面已改变/)
  assert.equal((await bridge('ocrDbNext')).idle,true);assert.equal(requests,0)
  assert.equal(store.question('q').status,'stale');store.db.close()
})
test('cancellation while the provider is running preserves manual text and prevents late commit',async()=>{
  await reset();await sync();await capture();store.edit('q',1,'人工修订')
  delayed=true;await bridge('ocrDbNext');await until(async()=>!!resolveRequest)
  await bridge('ocrDbCancel');resolveRequest!({markdown:'迟到识别',blocks:''})
  await until(async()=>!(await bridge('ocrDbGetStats')).running)
  assert.equal(store.question('q').effective_text,'人工修订');assert.equal(store.question('q').status,'cancelled');store.db.close()
})

test('saved synchronization cursor resumes remaining records without a fresh scope submission',async()=>{
  await reset();notes.note.body='<p>恢复后的原生题干</p>'
  store.db.exec('INSERT INTO ocr_sync_state(id,payload_json) VALUES(1,?)',[JSON.stringify({id:'sync-resume',ids:['q'],config,consentAt:1,force:false,total:1,done:0,failures:[],running:true})])
  await bridge('ocrDbNext');await until(async()=>!(await bridge('ocrDbGetStats')).sync.running)
  assert.equal(store.question('q').native_text,'恢复后的原生题干')
  const saved=JSON.parse(store.db.rows('SELECT payload_json FROM ocr_sync_state')[0].payload_json)
  assert.equal(saved.done,1);assert.equal(saved.running,false);assert.equal(requests,0);store.db.close()
})

test('pause stops incremental synchronization and resume continues from its saved cursor',async()=>{
  await reset();notes.note.body='<p>待同步的原生题干</p>'
  for(let i=0;i<12;i++)records['extra'+i]={...records.q,recordId:'extra'+i}
  await bridge('ocrDbSync',{consent:true});await bridge('ocrDbPause')
  await until(async()=>!(await bridge('ocrDbGetStats')).sync.running)
  const stopped=await bridge('ocrDbGetStats')
  assert.equal(stopped.paused,true);assert.ok(stopped.sync.done<13);assert.equal(stopped.sync.resumable,true)
  assert.equal((await bridge('ocrDbNext')).paused,true)
  for(const key of Object.keys(preferencesKV))delete preferencesKV[key]
  await bridge('ocrDbResume');await bridge('ocrDbNext')
  await until(async()=>!(await bridge('ocrDbGetStats')).sync.running)
  assert.equal((await bridge('ocrDbGetStats')).total,13);assert.equal((await bridge('ocrDbGetStats')).sync.done,13);store.db.close()
})

test('pause preserves the current successful response while blocking the next job; cancel revokes remaining work',async()=>{
  await reset();await sync();await capture();delayed=true;await bridge('ocrDbNext');await until(async()=>!!resolveRequest)
  await bridge('ocrDbPause');assert.equal((await bridge('ocrDbNext')).paused,true)
  resolveRequest!({markdown:'暂停期间完成的结果',blocks:''})
  await until(async()=>!(await bridge('ocrDbGetStats')).running)
  assert.equal(store.question('q').effective_text.includes('暂停期间完成的结果'),true)
  assert.equal((await bridge('ocrDbGetStats')).paused,true)
  await bridge('ocrDbCancel');assert.equal((await bridge('ocrDbNext')).paused,true);assert.equal(requests,1);store.db.close()
})

test('pause releases a foreground capture so resume does not wait for lease expiry',async()=>{
  await reset();await sync();const old=await bridge('ocrDbNext');assert.ok(old.lease)
  await bridge('ocrDbPause');assert.equal(store.active(old.jobId,old.lease),undefined)
  assert.equal(store.job(old.jobId).state,'pending')
  for(const key of Object.keys(preferencesKV))delete preferencesKV[key]
  await bridge('ocrDbResume');const resumed=await bridge('ocrDbNext');assert.equal(resumed.jobId,old.jobId);assert.notEqual(resumed.lease,old.lease)
  store.db.close()
})

test('question details and retry API operate only on the current source generation',async()=>{
  await reset();await sync();const first=await bridge('ocrDbNext');await bridge('ocrDbFailCapture',{jobId:first.jobId,lease:first.lease})
  const old=await bridge('ocrDbGetQuestion',{recordId:'q'})
  await bridge('ocrDbSync',{recordId:'q',force:true,consent:true});await until(async()=>!(await bridge('ocrDbGetStats')).sync.running)
  const current=await bridge('ocrDbGetQuestion',{recordId:'q'})
  assert.ok(current.jobs.every((j:any)=>j.id!==first.jobId));assert.equal(current.jobs.length,1)
  await assert.rejects(bridge('ocrDbRetryQuestion',{recordId:'q',generation:old.source_generation,confirmed:true}),/题目已更新/)
  const capture=await bridge('ocrDbNext');await bridge('ocrDbFailCapture',{jobId:capture.jobId,lease:capture.lease})
  const retry=await bridge('ocrDbRetryQuestion',{recordId:'q',generation:current.source_generation})
  assert.equal(retry.count,1);assert.equal((await bridge('ocrDbGetQuestion',{recordId:'q'})).jobs[0].state,'pending');store.db.close()
})


test('behavior settings persist, require upload consent and full sync reruns unchanged pictures',async()=>{
  await reset();await sync();const initial=store.question('q').source_generation
  await assert.rejects(bridge('ocrDbSavePreferences',{incremental:false}),/确认/)
  await bridge('ocrDbSavePreferences',{incremental:false,consent:true});await sync()
  assert.equal(store.question('q').source_generation,initial+1)
  assert.equal((await bridge('ocrDbGetPreferences')).incremental,false)
  await bridge('ocrDbSavePreferences',{autoRetry:true});assert.equal((await bridge('ocrDbGetPreferences')).autoRetry,true);store.db.close()
})

test('scheduled OCR checks due time, scope, pause and changed service configuration',async()=>{
  await reset();notes.note.body='<p>定期题干</p>'
  await assert.rejects(bridge('ocrDbSavePreferences',{scheduled:true}),/确认/)
  await bridge('ocrDbSavePreferences',{scheduled:true,engine:'glm-ocr',notebookId:'n',intervalHours:1,consent:true})
  assert.equal((await bridge('ocrDbAutoTick')).started,false)
  preferencesKV['mn4-answer-matcher.ocr.preferences.v1'].nextAt=1
  await bridge('ocrDbPause');assert.equal((await bridge('ocrDbAutoTick')).started,false)
  assert.equal((await bridge('ocrDbAutoTick',{enter:true})).started,true)
  await until(async()=>!(await bridge('ocrDbGetStats')).sync.running)
  assert.equal(store.question('q').status,'not_needed');assert.equal(requests,0)
  const pref=preferencesKV['mn4-answer-matcher.ocr.preferences.v1'];pref.nextAt=1;pref.configKey='changed'
  await assert.rejects(bridge('ocrDbAutoTick'),/服务设置已变化/);assert.equal((await bridge('ocrDbGetPreferences')).scheduled,false);store.db.close()
})

test('native backup picker waits for its callback and import requires confirmation and an idle queue',async()=>{
  await reset();notes.note.body='<p>备份题干</p>';await sync()
  const value=await bridge('ocrDbBackup');assert.equal(savePanels,1);selectedBackup=value.path
  backupFiles.get(value.path).tables.ocr_questions[0].manual_text={nativeNull:true}
  const selected=await bridge('ocrDbSelectBackup');assert.equal(selected.questions,1);assert.ok(selected.token)
  await assert.rejects(bridge('ocrDbImportBackup',{token:selected.token}),/确认/)
  store.edit('q',store.question('q').revision,'替换前正文')
  await bridge('ocrDbImportBackup',{token:selected.token,confirmed:true});assert.equal(store.question('q').effective_text.includes('备份题干'),true)
  assert.equal((await bridge('ocrDbGetStats')).paused,true);await assert.rejects(bridge('ocrDbImportBackup',{token:selected.token,confirmed:true}),/过期/)
  selectedBackup=undefined;assert.equal((await bridge('ocrDbSelectBackup')).cancelled,true);store.db.close()
})

test('automatic retries are bounded and never resubmit uncertain outcomes',async()=>{
  await reset();await bridge('ocrDbSavePreferences',{autoRetry:true});await sync();await capture();providerFailure='rate'
  for(let attempt=1;attempt<=3;attempt++){
    store.db.exec('UPDATE ocr_jobs SET next_at=0');await bridge('ocrDbNext');await until(async()=>!(await bridge('ocrDbGetStats')).running)
    const job=store.db.rows("SELECT * FROM ocr_jobs WHERE asset_id<>''")[0];assert.equal(job.attempts,attempt);assert.equal(job.state,attempt<3?'pending':'failed')
  }
  store.db.close();await reset();await bridge('ocrDbSavePreferences',{autoRetry:true});await sync();await capture();providerFailure='network'
  await bridge('ocrDbNext');await until(async()=>!(await bridge('ocrDbGetStats')).running)
  assert.equal(store.db.rows("SELECT state FROM ocr_jobs WHERE asset_id<>''")[0].state,'uncertain');assert.equal(requests,1);store.db.close()
})

test('workbench refresh indexes edits and uses only explicitly authorized automatic OCR', async () => {
  await reset()
  notes.note.body = '<p>计算 Ｚ 变换</p>'
  await bridge('ocrDbRefreshSources')
  assert.deepEqual((await bridge('ocrDbSearchContent',{query:'Z变换'})).recordIds,['q'])
  notes.note.body = '<img src="data:image/jpeg;base64,aW1hZ2U=" />'
  await bridge('ocrDbRefreshSources')
  assert.deepEqual((await bridge('ocrDbSearchContent',{query:'Z变换'})).recordIds,[])
  assert.equal((await bridge('ocrDbNext',{automatic:true})).idle,true)
  assert.equal(store.currentJobs('q').length,0)
  await bridge('ocrDbSavePreferences',{scheduled:true,consent:true,notebookId:'other'})
  await bridge('ocrDbRefreshSources')
  assert.equal((await bridge('ocrDbNext',{automatic:true})).idle,true)
  await bridge('ocrDbSavePreferences',{scheduled:true,consent:true,notebookId:'n'})
  await bridge('ocrDbRefreshSources')
  const claim = await bridge('ocrDbNext',{automatic:true})
  assert.equal(claim.recordId,'q')
  await bridge('ocrDbReleaseCapture',{jobId:claim.jobId,lease:claim.lease})
  await capture()
  await bridge('ocrDbNext',{automatic:true})
  await until(async()=>!(await bridge('ocrDbGetStats')).running)
  assert.deepEqual((await bridge('ocrDbSearchContent',{query:'正定矩阵'})).recordIds,['q'])
  records.q.level=2
  await bridge('ocrDbRefreshSources')
  assert.equal((await bridge('ocrDbNext',{automatic:true})).idle,true)
  assert.equal(requests,1)
  delete records.q
  await bridge('ocrDbRefreshSources')
  assert.deepEqual((await bridge('ocrDbSearchContent',{query:'正定矩阵'})).recordIds,[])
  store.db.close()
})
