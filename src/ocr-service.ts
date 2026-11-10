import { MN, delay, isNSNull, getLocalDataByKey, setLocalDataByKey } from 'marginnote'
import { loadMistakeState } from './mistake-store'
import { renderCardHtml } from './card-html'
import { questionBody, questionNativeText } from './ocr-question'
import { sha256Bytes, sha256Hex } from './content-fingerprint'
import { decodeBase64Bytes } from './base64'
import { ocrStore, diagnoseOCR } from './ocr-native'
import { checkCredential, providerConfig, recognizeAsset, OCRProviderError, OCRPausedError } from './ocr-provider'
import type { OCRConfig, SourceQuestion } from './ocr-store'
import { recordRuntimeState } from './note-navigation'
import { ocrPreferences, safeAutomaticRetry } from './ocr-preferences'
import { backupOCR, selectOCRBackup, importOCRBackup } from './ocr-maintenance'
import { renderOCRMarkdownPreview } from './markdown'
const preferencesKey='mn4-answer-matcher.ocr.preferences.v1'
const preferences=()=>ocrPreferences(getLocalDataByKey(preferencesKey))
function savePreferences(value:any){const next=ocrPreferences(value);setLocalDataByKey(next,preferencesKey);return next}
function requireIdle(){if(running||syncing||refreshing||ocrStore().db.rows("SELECT id FROM ocr_jobs WHERE state='rendering' AND lease_until>? LIMIT 1",[Date.now()]).length)throw new Error('请先暂停识别，等待当前请求完成后再操作')}
function liveIds(){return Object.keys(loadMistakeState().records)}

function source(recordId: string, loadedNote?: ReturnType<typeof MN.db.getNoteById>): { question: SourceQuestion; html: string } {
  const record = loadMistakeState().records[recordId]
  if (!record) throw new Error('错题记录已删除')
  // Direct ID lookup only; unavailable sources remain visible rather than triggering a notebook scan.
  const note = loadedNote ?? MN.db.getNoteById(record.sourceNoteId)
  if (!note || isNSNull(note)) throw new Error('原卡片暂不可读，请打开对应学习集后重新同步')
  const media = (hash: string) => {
    const data:any = MN.db.getMediaByHash(hash)
    if (!data || isNSNull(data)) throw new Error('题目原图暂不可读')
    return String(data.base64Encoding())
  }
  const html = renderCardHtml(note,'错题原题',() => undefined,media,media,false,false,false,{handwriting:false,comments:false})
  const body = questionBody(html).replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i,'').replace(/<div\b[^>]*class="eyebrow"[^>]*>[\s\S]*?<\/div>/gi,'')
  if (/class="missing-image"/.test(body)) throw new Error('题目图片缺失，不能识别')
  const nativeText = questionNativeText(body), needsOCR = /<img\b/i.test(body)
  return {html,question:{recordId,notebookId:record.sourceNotebookId,noteId:record.sourceNoteId,title:record.sourceTitle,metadata:[record.sourceNotebookTitle,...record.categoryPath].join(' '),fingerprint:sha256Hex(body),nativeText,needsOCR}}
}
let syncing = false, syncProgress:any = null, running = false, cancelSync = false, paused = false
const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
let counter = 0
function current(j:any) {
  if (ocrStore().question(j.record_id)?.source_generation !== j.generation) throw new Error('该任务已被新一轮识别替代')
  if (!loadMistakeState().records[j.record_id]) {
    const s = ocrStore(); s.db.exec('DELETE FROM ocr_questions WHERE record_id=?',[j.record_id]); throw new Error('错题记录已删除')
  }
  const value = source(j.record_id)
  if (value.question.fingerprint !== j.fingerprint) {
    ocrStore().db.exec("UPDATE ocr_jobs SET state='stale',lease='' WHERE question_id=? AND fingerprint=?",[j.question_id,j.fingerprint])
    ocrStore().db.exec("UPDATE ocr_questions SET status='stale' WHERE id=?",[j.question_id])
    throw new Error('题面已改变，请重新同步并确认上传范围')
  }
  return value
}
function persistSync() { ocrStore().db.exec('INSERT OR REPLACE INTO ocr_sync_state(id,payload_json) VALUES(1,?)',[JSON.stringify(syncProgress)]) }
function savedSync() { const row=ocrStore().db.rows('SELECT payload_json FROM ocr_sync_state WHERE id=1')[0]; return row ? JSON.parse(row.payload_json) : null }
async function syncQuestions(ids:string[],config:OCRConfig,consentAt:number,force:boolean,resume?:any,resumeIncomplete=false) {
  syncing = true; cancelSync = false; syncProgress = resume || {id:`sync-${Date.now()}`,total:ids.length,done:0,failures:[] as any[],running:true,ids,config,consentAt,force,resumeIncomplete}
  syncProgress.running=true;persistSync()
  try {
    for (let index=syncProgress.done;index<ids.length;index++) {
      const id=ids[index]
      if (cancelSync || paused) break
      try { const value = source(id); ocrStore().sync(value.question,config,consentAt,force,syncProgress.resumeIncomplete === true) }
      catch (error:any) { syncProgress.failures.push({recordId:id,title:loadMistakeState().records[id]?.sourceTitle,error:String(error.message || error)}) }
      syncProgress.done++;persistSync(); await delay(.01)
    }
    // Only explicit removal from the authoritative mistake index removes library rows.
    const live = loadMistakeState().records
    for (const row of ocrStore().db.rows('SELECT record_id FROM ocr_questions')) if (!live[row.record_id]) ocrStore().db.exec('DELETE FROM ocr_questions WHERE record_id=?',[row.record_id])
  } finally { syncing = false; syncProgress.running = false;syncProgress.cancelled=cancelSync;persistSync() }
}
async function run(j:any) {
  running = true
  const s = ocrStore(),startedAt=Date.now()
  try {
    current(j)
    const cached = s.cached(j)
    if (cached) { s.finish(j.id,j.lease,cached.markdown,cached.blocks_json); return }
    const asset = s.db.rows('SELECT data_uri FROM ocr_assets WHERE id=?',[j.asset_id])[0]
    if (!asset) throw new Error('输入图片缺失，请重新同步')
    const mime=/^data:([^;,]+)/.exec(asset.data_uri)?.[1]||'unknown'
    const encoded=String(asset.data_uri).split(',')[1]||''
    const bytes=Math.max(0,Math.floor(encoded.length*3/4)-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0))
    recordRuntimeState('OCR','request',`job=${j.id} generation=${j.generation} engine=${j.engine} mime=${mime} bytes=${bytes}`)
    const result = await recognizeAsset(JSON.parse(j.config_json),asset.data_uri,j.remote_id,{
      paused:()=>paused,
      response(method,status,serviceCode){recordRuntimeState('OCR','response',`job=${j.id} engine=${j.engine} method=${method} http=${status} code=${serviceCode||'none'} elapsedMs=${Date.now()-startedAt}`)},
      check() { if (!s.active(j.id,j.lease)) throw new Error('任务已取消或过期') },
      stage(state,remoteId) { s.stage(j.id,j.lease,state,remoteId) }
    })
    // Cache a successfully recognized input even if its source changed during the request.
    s.db.exec('INSERT OR REPLACE INTO ocr_results(asset_id,engine,model,options_hash,markdown,blocks_json) VALUES(?,?,?,?,?,?)',[j.asset_id,j.engine,j.model,j.options_hash,result.markdown,result.blocks])
    current(j)
    s.finish(j.id,j.lease,result.markdown,result.blocks)
    recordRuntimeState('OCR','completed',`job=${j.id} elapsedMs=${Date.now()-startedAt}`)
  } catch (error:any) {
    if(error instanceof OCRPausedError){s.suspend(j.id,j.lease);return}
    const latest = s.job(j.id)
    // A GLM submission without a response, or an interrupted MinerU create, can have charged.
    const uncertain = latest?.state === 'uploading' && !latest?.remote_id && (!(error instanceof OCRProviderError) || error.uncertain)
    recordRuntimeState('OCR','failed',`job=${j.id} engine=${j.engine} kind=${error instanceof OCRProviderError?error.kind:'internal'} uncertain=${!!uncertain} elapsedMs=${Date.now()-startedAt}`)
    // Never persist service error text: it can contain URLs, credentials or response payloads.
    s.fail(j.id,j.lease,uncertain ? `提交结果不确定；重新提交可能重复计费${error instanceof OCRProviderError?'；'+error.message:''}` : error instanceof OCRProviderError ? error.message : latest?.remote_id ? '远程任务未完成，可恢复查询；上传中断的批次可能需要单题重新识别' : '识别未完成，请检查凭据、网络与原题',uncertain)
    const prefs=preferences(),failed=s.job(j.id)
    if(prefs.autoRetry&&error instanceof OCRProviderError&&failed?.state==='failed'&&safeAutomaticRetry(error.kind,!!uncertain,failed.attempts))s.retry(j.id,false)
  } finally { running = false }
}
export async function ocrBridge(command:string,payload:any = {}) {
  if (command === 'ocrDbRenderPreview') {
    const text = String(payload.text ?? '')
    if (text.length > 500000) throw new Error('预览正文过长')
    return { html: renderOCRMarkdownPreview(text) }
  }
  const s = ocrStore()
  if(command==='ocrDbGetPreferences')return preferences()
  if(command==='ocrDbSavePreferences'){
    const previous=preferences(),next=ocrPreferences({...previous,...payload,sourceConsent:previous.sourceConsent,consentAt:previous.consentAt,configKey:previous.configKey,nextAt:previous.nextAt})
    if((!next.incremental&&previous.incremental)||next.scheduled&&(!previous.scheduled||payload.engine!==undefined||payload.notebookId!==undefined||payload.intervalHours!==undefined)){
      if(payload.consent!==true)throw new Error('请先确认自动识别的服务和上传范围')
      next.sourceConsent = next.scheduled && (payload.scheduled === true || previous.sourceConsent)
      next.consentAt=Date.now();next.configKey=JSON.stringify(providerConfig(next.engine));next.nextAt=Date.now()+next.intervalHours*3600000
    }
    if (!next.scheduled) next.sourceConsent = false
    if(next.scheduled&&!previous.scheduled)paused=false
    return savePreferences(next)
  }
  if(command==='ocrDbAutoTick'){
    const p=preferences()
    if((paused&&payload.enter!==true)||running||syncing||refreshing||!p.scheduled||!p.consentAt||Date.now()<p.nextAt)return {started:false}
    if(p.configKey!==JSON.stringify(providerConfig(p.engine))){savePreferences({...p,scheduled:false});throw new Error('服务设置已变化，请重新开启定期 OCR 并确认范围')}
    const progress=syncProgress||savedSync()
    if(progress&&!progress.cancelled&&progress.done<progress.total)return {started:false}
    if(s.db.rows("SELECT id FROM ocr_jobs WHERE state IN ('pending','rendering','recognizing','uploading','downloading','normalizing') LIMIT 1").length)return {started:false}
    checkCredential(p.engine);paused=false
    const ids=liveIds().filter(id=>!p.notebookId||loadMistakeState().records[id].sourceNotebookId===p.notebookId)
    savePreferences({...p,nextAt:Date.now()+p.intervalHours*3600000})
    const config=providerConfig(p.engine,p.incremental?'':`${Date.now()}-${++counter}`)
    void syncQuestions(ids,config,p.consentAt,!p.incremental).catch(()=>{syncProgress.error='定期同步中断，请检查数据库'})
    return {started:true,total:ids.length}
  }
  if(command==='ocrDbBackup'){requireIdle();return backupOCR()}
  if(command==='ocrDbSelectBackup'){requireIdle();return selectOCRBackup()}
  if(command==='ocrDbImportBackup'){requireIdle();if(payload.confirmed!==true)throw new Error('请确认替换 OCR 数据库');const result=importOCRBackup(String(payload.token||''));syncProgress=null;paused=true;savePreferences({...preferences(),scheduled:false});return result}
  if(command==='ocrDbPreviewCleanup'){requireIdle();return s.orphanSummary(liveIds())}
  if(command==='ocrDbCleanup'){requireIdle();if(payload.confirmed!==true)throw new Error('请确认清理预览');return s.cleanOrphans(liveIds())}
  if (command === 'ocrDbGetStats') {
    const progress=syncProgress || savedSync()
    return {...s.stats(),sync:progress ? {id:progress.id,total:progress.total,done:progress.done,failures:progress.failures,error:progress.error,running:syncing,resumable:!progress.cancelled && progress.done<progress.total} : null,running,paused}
  }
  if (command === 'ocrDbCapabilities') {
    if (running || syncing || refreshing || s.db.rows("SELECT id FROM ocr_jobs WHERE state='rendering' AND lease_until>? LIMIT 1",[Date.now()]).length) throw new Error('请先暂停或取消队列，再检查数据库')
    return diagnoseOCR()
  }
  if (command === 'ocrDbRefreshSources') return refreshSources()
  if (command === 'ocrDbReleaseCapture') {
    s.releaseCapture(Number(payload.jobId),String(payload.lease))
    return {accepted:true}
  }
  if (command === 'ocrDbSearchContent') return { recordIds: s.searchContent(String(payload.query || '')) }
  if (command === 'ocrDbSearch') return s.search(String(payload.query || ''),Number(payload.offset)||0,Number(payload.limit)||30,String(payload.notebookId || ''),String(payload.status || ''))
  if (command === 'ocrDbGetOriginalImages') {
    const { html } = source(String(payload.recordId || ''))
    const images = Array.from(questionBody(html).matchAll(/<img\b[^>]*\bsrc="(data:image\/[^";]+;base64,[A-Za-z0-9+/=]+)"/gi), match => match[1])
    return { images }
  }
  if (command === 'ocrDbGetQuestion') {
    const q = s.question(String(payload.recordId)); if (!q) throw new Error('题目尚未入库')
    return {...q,jobs:s.currentJobs(q.record_id)}
  }
  if (command === 'ocrDbEditQuestion') { const value = payload.text === null ? null : String(payload.text || ''); if (value && value.length>500000) throw new Error('修订正文过长'); return s.edit(String(payload.recordId),Number(payload.revision),value) }
  if (command === 'ocrDbRebuildSearch') return s.rebuild()
  if(command==='ocrDbPause'){paused=true;s.releaseCaptures();return {paused:true}}
  if(command==='ocrDbResume'){paused=false;return {paused:false}}
  if (command === 'ocrDbCancel') { paused=true;cancelSync = true; s.cancel(); if (!syncing) { const saved=savedSync(); if(saved){syncProgress={...saved,cancelled:true,running:false};persistSync()} } return {cancelled:true} }
  if (command === 'ocrDbRetry') { s.retry(Number(payload.jobId),payload.confirmed === true); return {accepted:true} }
  if(command==='ocrDbRetryFailedBatch'){
    const confirmation=String(payload.confirmation||'')
    if(confirmation&&(running||syncing))throw new Error('请等待当前任务完成后再重试')
    return s.retryFailedBatch(new Set(liveIds()),confirmation)
  }
  if(command==='ocrDbRetryQuestion')return s.retryQuestion(String(payload.recordId),Number(payload.generation),payload.confirmed===true,payload.onlyFailed===true)
  if (command === 'ocrDbSync') {
    if (syncing || running || refreshing) throw new Error('请等待当前任务完成后再同步')
    const previous=savedSync()
    if(previous&&!previous.cancelled&&previous.done<previous.total)throw new Error('请先继续或取消未完成的同步')
    if (payload.consent !== true) throw new Error('请先确认服务方和题目上传范围')
    const engine = payload.engine === 'mineru' ? 'mineru' : 'glm-ocr'
    const force=payload.force===true||!preferences().incremental
    const config = providerConfig(engine,force ? `${Date.now()}-${++counter}` : '')
    const records = loadMistakeState().records
    const ids = payload.recordId ? [String(payload.recordId)] : Object.keys(records).filter(id => !payload.notebookId || records[id].sourceNotebookId === payload.notebookId)
    paused=false
    void syncQuestions(ids,config,Date.now(),force,undefined,!force).catch(() => { syncProgress.error='同步中断，请检查数据库后重试' })
    return {accepted:true,total:ids.length,jobId:syncProgress.id}
  }
  if (command === 'ocrDbNext') {
    if(paused)return {paused:true}
    if (syncing || running) return {busy:true}
    const saved=savedSync()
    if (payload.automatic !== true && saved && !saved.cancelled && saved.done<saved.total) {
      void syncQuestions(saved.ids,saved.config,saved.consentAt,saved.force,saved).catch(()=>{syncProgress.error='同步中断，请检查数据库后重试'})
      return {busy:true}
    }
    if (refreshing || s.db.rows("SELECT id FROM ocr_jobs WHERE state='rendering' AND lease_until>? LIMIT 1",[Date.now()]).length) return {busy:true}
    const automatic = payload.automatic === true
    const consent = automatic ? automaticConsent() : undefined
    if (automatic && !consent) return {idle:true}
    const j = s.claim(Date.now(),`${session}-${++counter}`,consent?.at)
    if (!j) return {idle:true}
    try {
      if (j.asset_id) { if (!s.cached(j)) checkCredential(j.engine); void run(j); return {busy:true} }
      const value = current(j)
      return {jobId:j.id,lease:j.lease,recordId:j.record_id,title:value.question.title,html:value.html}
    } catch (error:any) { s.fail(j.id,j.lease,String(error.message || error)); return {busy:true} }
  }
  if (command === 'ocrDbSubmitImages') {
    const j = s.active(Number(payload.jobId),String(payload.lease)); if (!j) throw new Error('OCR 截图任务已过期')
    current(j)
    const images = payload.images
    if (!Array.isArray(images) || !images.length || images.length>30) throw new Error('题目截图数量无效')
    const assets = []
    for (const uri of images) {
      if (typeof uri !== 'string' || !/^data:image\/jpeg;base64,/.test(uri) || uri.length>14000000) throw new Error('题目截图格式或大小无效')
      const bytes = decodeBase64Bytes(uri)
      if (bytes.length>10*1024*1024) throw new Error('单张截图超过 10 MB')
      assets.push({hash:sha256Bytes(bytes),dataUri:uri})
      await delay(.01)
    }
    current(j); s.attach(j.id,j.lease,assets); return {accepted:true}
  }
  if (command === 'ocrDbFailCapture') { s.fail(Number(payload.jobId),String(payload.lease),'题目截图失败，请检查原图后重试'); return {accepted:true} }
  throw new Error('未知 OCR 数据库命令')
}

function automaticConsent() {
  const prefs = preferences()
  if (paused || !prefs.scheduled || !prefs.sourceConsent || !prefs.consentAt) return
  try {
    const config = providerConfig(prefs.engine)
    if (JSON.stringify(config) !== prefs.configKey) return
    checkCredential(prefs.engine)
    return { config, at: prefs.consentAt, notebookId: prefs.notebookId }
  } catch {
    // Local indexing remains available without a valid provider configuration.
    return
  }
}

let refreshing: Promise<{ changed: boolean }> | undefined
let refreshRequested = false
function refreshSources() {
  refreshRequested = true
  if (refreshing) return refreshing
  refreshing = (async () => {
    let changed = false
    do {
      refreshRequested = false
      const result = await indexLiveSources()
      changed ||= result.changed
    } while (refreshRequested)
    return { changed }
  })().finally(() => { refreshing = undefined })
  return refreshing
}

async function indexLiveSources() {
  const store = ocrStore()
  const records = Object.values(loadMistakeState().records)
  const started = Date.now()
  let checked = 0, skipped = 0, extracted = 0, failed = 0, removed = 0, extractMs = 0, writeMs = 0
  let changed = false
  let consent = automaticConsent()
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (index % 12 === 0) { await delay(.01); consent = automaticConsent() }
    if (syncing) break
    if (!loadMistakeState().records[record.recordId]) continue
    checked++
    try {
      const note = MN.db.getNoteById(record.sourceNoteId)
      if (!note || isNSNull(note)) { failed++; continue }
      const scoped = consent && (!consent.notebookId || consent.notebookId === record.sourceNotebookId) ? consent : undefined
      const modified = note.modifiedDate
      const modifiedKey = modified instanceof Date ? modified.getTime() : String(modified ?? '')
      const revision = modified && modifiedKey ? JSON.stringify([1, record.sourceNoteId, modifiedKey, record.sourceTitle, record.sourceNotebookId, record.sourceNotebookTitle, record.categoryPath, scoped?.at]) : undefined
      if (revision && store.sourceIsCurrent(record.recordId, revision)) { skipped++; continue }
      const before = store.question(record.recordId)
      const extractStarted = Date.now()
      let value: ReturnType<typeof source>
      try { value = source(record.recordId, note); extracted++ }
      finally { extractMs += Date.now() - extractStarted }
      const writeStarted = Date.now()
      let after: ReturnType<typeof store.sync>
      try { after = store.sync(value.question, scoped?.config, scoped?.at ?? 0, false, false, revision) }
      finally { writeMs += Date.now() - writeStarted }
      changed ||= !before || before.search_text !== after.search_text || before.status !== after.status || before.source_generation !== after.source_generation
    } catch (error: any) {
      failed++
      recordRuntimeState('OCR', 'sourceUnavailable', 'recordId=' + record.recordId)
    }
  }
  const live = loadMistakeState().records
  for (const row of store.db.rows('SELECT record_id FROM ocr_questions')) {
    if (live[row.record_id]) continue
    const writeStarted = Date.now()
    store.db.exec('DELETE FROM ocr_questions WHERE record_id=?',[row.record_id])
    writeMs += Date.now() - writeStarted
    removed++
    changed = true
  }
  recordRuntimeState('OCR', 'sourceRefresh', `total=${records.length} checked=${checked} skipped=${skipped} extracted=${extracted} failed=${failed} removed=${removed} extractMs=${extractMs} writeMs=${writeMs} elapsedMs=${Date.now() - started}`)
  return { changed }
}
