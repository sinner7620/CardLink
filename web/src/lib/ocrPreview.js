let questions=[],paused=false,preferences={incremental:true,autoRetry:false,scheduled:false,intervalHours:24},backup=null
export function ocrPreview(command,payload,records){
  const p=payload||{}
  if(command==='ocrDbRenderPreview'){
    if(import.meta.env.DEV) return import('../../../src/markdown').then(({renderOCRMarkdownPreview})=>({html:renderOCRMarkdownPreview(p.text)}))
    const render=window.__MN_PREVIEW_RENDER_OCR__
    if(!render) throw new Error('演示预览渲染器未加载')
    return {html:render(p.text)}
  }
  if(command==='ocrDbSearchContent')return {recordIds:questions.filter(q=>q.effective_text.normalize('NFKC').toLowerCase().includes(String(p.query||'').normalize('NFKC').toLowerCase())).map(q=>q.record_id)}
  if(command==='ocrDbGetPreferences')return {...preferences}
  if(command==='ocrDbSavePreferences'){preferences={...preferences,...p};return {...preferences}}
  if(command==='ocrDbRefreshSources')return {changed:false}
  if(command==='ocrDbReleaseCapture')return {accepted:true}
  if(command==='ocrDbAutoTick')return {started:false}
  if(command==='ocrDbBackup'){backup=JSON.parse(JSON.stringify(questions));return{created:true,filename:'CardLink-OCR-preview.json',savePanelOpened:true}}
  if(command==='ocrDbSelectBackup'){if(!backup)throw new Error('请先生成演示备份');return {questions:backup.length,assets:0,token:'preview'}}
  if(command==='ocrDbImportBackup'){questions=JSON.parse(JSON.stringify(backup));return{restored:true,questions:questions.length,assets:0}}
  if(command==='ocrDbPreviewCleanup')return{questions:0,assets:0,bytes:0}
  if(command==='ocrDbCleanup')return{questions:0,assets:0,cleaned:true}
  if(command==='ocrDbGetStats')return{preview:true,databaseBytes:65536,paused,total:questions.length,states:[{status:'ready',count:questions.length}],jobs:[],schemaVersion:1}
  if(command==='ocrDbSearch'){
    const matched=questions.filter(q=>(!p.notebookId||q.notebook_id===p.notebookId)&&(!p.status||q.status===p.status||(p.status==='completed'&&['ready','not_needed'].includes(q.status))||(p.status==='waiting'&&['pending','stale','cancelled'].includes(q.status)))&&`${q.record_id} ${q.title} ${q.effective_text}`.includes(p.query||''))
    return{total:matched.length,items:matched.slice(p.offset||0,(p.offset||0)+(p.limit||30)).map(q=>({...q,excerpt:q.effective_text.slice(0,160),edited:q.manual_text!==null}))}
  }
  if(command==='ocrDbSync'){
    paused=false
    if(!p.consent)throw new Error('请先确认识别范围')
    for(const record of records.filter(r=>(!p.recordId||r.recordId===p.recordId)&&(!p.notebookId||r.sourceNotebookId===p.notebookId))){
      if(!questions.some(q=>q.record_id===record.recordId))questions.push({record_id:record.recordId,notebook_id:record.sourceNotebookId,title:record.sourceTitle,status:'ready',effective_text:'演示题干：设 A 为正定矩阵，讨论相似矩阵的特征值。\\frac{1}{2}',manual_text:null,revision:1,source_generation:1,jobs:[]})
    }
    return{accepted:true}
  }
  if(command==='ocrDbPause'){paused=true;return{paused:true}}
  if(command==='ocrDbResume'){paused=false;return{paused:false}}
  if(command==='ocrDbRetryFailedBatch')return {signature:'',questions:0,uncertain:0,count:0}
  if(command==='ocrDbRetryQuestion')return{accepted:true,count:1}
  if(command==='ocrDbNext')return paused?{paused:true}:{idle:true}
  if(command==='ocrDbGetOriginalImages')return {images:[]}
  if(command==='ocrDbGetQuestion')return questions.find(q=>q.record_id===p.recordId)
  if(command==='ocrDbEditQuestion'){
    const q=questions.find(q=>q.record_id===p.recordId)
    if(q.revision!==p.revision)throw new Error('题目已更新')
    q.manual_text=p.text;q.effective_text=p.text??'演示题干：正定矩阵';q.revision++;return{...q}
  }
  if(['ocrDbCancel','ocrDbCapabilities','ocrDbRebuildSearch'].includes(command))return{ok:true,preview:true}
  throw new Error('浏览器预览不执行真实 OCR 任务')
}
