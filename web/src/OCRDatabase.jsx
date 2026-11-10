import React, { useEffect, useRef, useState } from 'react'
import MNBridge from './lib/mnBridge'
import { OCRCredential } from './OCRCredential'
import { OCRCapture } from './OCRCapture'
import './ui/ocr-database.css'

function OCRRenderedPreview({text}) {
  const [result, setResult] = useState(null)
  useEffect(() => {
    let active = true
    MNBridge.send('ocrDbRenderPreview', {text}).then(
      ({html}) => { if (active) setResult({text, html}) },
      error => { if (active) setResult({text, error: error?.message || String(error)}) }
    )
    return () => { active = false }
  }, [text])

  const current = result?.text === text ? result : null
  if (!current || current.error) {
    return <div className="markdownPreview ocrRenderedText" role="status">{current?.error || '正在渲染…'}</div>
  }
  return <div className="markdownPreview ocrRenderedText" dangerouslySetInnerHTML={{__html:current.html}}/>
}

const labels = {ready:'已识别',not_needed:'原生文字',pending:'待处理',stale:'题面已变化',failed:'失败',cancelled:'已取消',uncertain:'待确认',rendering:'准备图片',uploading:'上传中',recognizing:'识别中',downloading:'下载中',normalizing:'整理中'}
export function OCRDatabase({onBack,sourceRevision,onQueueActive,onIndexed,onPreferencesChanged,Select='select',Switch,Morph}) {
  const [stats,setStats] = useState(null), [settings,setSettings] = useState(null), [sets,setSets] = useState([])
  const [engine,setEngine] = useState('glm-ocr'), [scope,setScope] = useState(''), [query,setQuery] = useState(''), [filter,setFilter] = useState(''), [offset,setOffset] = useState(0)
  const [result,setResult] = useState({items:[],total:0}), [message,setMessage] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false)
  const [page,setPage] = useState('overview'), [attention,setAttention] = useState([])
  const [searchError,setSearchError] = useState('')
  const [consent,setConsent] = useState(null), [running,setRunning] = useState(false), [capture,setCapture] = useState(null), [detail,setDetail] = useState(null), [draft,setDraft] = useState(''), [refresh,setRefresh] = useState(0)
  useEffect(()=>{let active=true;Promise.all(['failed','waiting'].map(status=>MNBridge.send('ocrDbSearch',{status,limit:3,offset:0}))).then(rows=>{if(active)setAttention(rows.flatMap(r=>r.items).slice(0,4))}).catch(()=>{});return()=>{active=false}},[refresh,sourceRevision])
  const [advanced,setAdvanced]=useState(false),[preferences,setPreferences]=useState(null),[maintenance,setMaintenance]=useState(null)
  const initializedSettings=useRef(false)
  const request = useRef(0), mounted = useRef(true), captureRef = useRef(null)
  captureRef.current = capture
  const send = (cmd,payload) => MNBridge.send(cmd,payload)
  const fail = reason => setError(reason?.message || String(reason))
  async function statsLoad() { const value = await send('ocrDbGetStats'); if(mounted.current) setStats(value); return value }
  async function loadSettings(){
    const value=await send('ocrGetSettings')
    if(mounted.current){setSettings(value);if(!initializedSettings.current){setEngine(value.ocrEngine==='mineru'?'mineru':'glm-ocr');initializedSettings.current=true}}
  }
  async function pauseQueue(){setRunning(false);captureRef.current=null;setCapture(null);await action(()=>send('ocrDbPause'),'已暂停，当前请求完成后停止')}
  async function resumeQueue(){await action(async()=>{await send('ocrDbResume');setRunning(true)},'已继续队列')}
  async function cancelQueue(){setRunning(false);captureRef.current=null;setCapture(null);await action(()=>send('ocrDbCancel'),'已取消队列')}
  function leave(){setRunning(false);captureRef.current=null;setCapture(null);onBack()}
  useEffect(() => {
    mounted.current=true
    // Settings remain usable when the independent SQLite initialization fails.
    statsLoad().catch(fail)
    loadSettings().catch(fail)
    send('ocrDbGetPreferences').then(value=>{if(mounted.current)setPreferences(value)}).catch(fail)
    send('ocrListMistakeStudySets').then(value=>{if(mounted.current)setSets(value)}).catch(fail)
    return () => {mounted.current=false}
  },[])
  useEffect(() => { onQueueActive?.(running); return () => onQueueActive?.(false) }, [running,onQueueActive])
  useEffect(() => { if(sourceRevision)statsLoad().catch(fail) }, [sourceRevision])
  useEffect(() => {
    const seq=++request.current
    const timer=setTimeout(()=>send('ocrDbSearch',{query,notebookId:scope,status:filter==='ready'?'completed':filter==='pending'?'waiting':filter,offset,limit:30}).then(value=>{if(mounted.current && seq===request.current){setResult(value);setSearchError('')}}).catch(reason=>{if(mounted.current && seq===request.current){setResult({items:[],total:0});setSearchError(reason?.message || String(reason))}}),180)
    return ()=>{clearTimeout(timer);request.current++}
  },[query,scope,filter,offset,refresh,sourceRevision])
  useEffect(() => {
    if(!running)return
    let stopped=false, timer, inFlight=false
    async function tick(){
      if(stopped || inFlight)return
      inFlight=true
      try {
        const state=await statsLoad()
        if(stopped)return
        setRefresh(n=>n+1)
        if(!captureRef.current){
          const next=await send('ocrDbNext')
          if(stopped){if(next.html)void send('ocrDbReleaseCapture',{jobId:next.jobId,lease:next.lease}).catch(()=>{});return}
          if(next.paused){setRunning(false);return}
          if(next.html){captureRef.current=next;setCapture(next)}
          else if(next.idle && !state.sync?.running && !state.jobs.some(j=>['pending','rendering','recognizing','uploading','downloading','normalizing'].includes(j.state))){setRunning(false);setMessage('本轮处理完成');onIndexed?.();return}
        }
      } catch(reason){if(!stopped){fail(reason);setRunning(false)}}
      finally{inFlight=false;if(!stopped)timer=setTimeout(tick,1400)}
    }
    tick();return()=>{stopped=true;clearTimeout(timer)}
  },[running])
  async function action(work,success='',refreshStats=true) {setError('');setBusy(true);try{await work();if(success)setMessage(success);if(refreshStats)await statsLoad();setRefresh(n=>n+1)}catch(reason){fail(reason)}finally{setBusy(false)}}
  const [textMode,setTextMode]=useState('raw')
  const [original,setOriginal]=useState(null)
  async function showOriginal(recordId){
    setOriginal({recordId,loading:true})
    try {
      const {images}=await send('ocrDbGetOriginalImages',{recordId})
      setOriginal(current=>current?.recordId===recordId?{recordId,images}:current)
    } catch(error) {
      setOriginal(current=>current?.recordId===recordId?{recordId,error:error?.message||String(error)}:current)
    }
  }
  async function open(recordId){setOriginal(null);setTextMode('raw');await action(async()=>{const q=await send('ocrDbGetQuestion',{recordId});setDetail(q);setDraft(q.effective_text)})}
  async function start(){
    const selected=consent
    if(selected?.batch){
      await action(async()=>{
        const result=await send('ocrDbRetryFailedBatch',{confirmation:selected.batch.signature})
        await send('ocrDbResume');setRunning(true);setConsent(null)
        setMessage(`已将 ${result.questions} 道题加入重试队列`)
      })
      return
    }
    if(selected?.retry){await retryQuestion(true);return}
    await action(async()=>{
      await send('ocrDbSync',{engine,notebookId:scope,recordId:selected?.recordId,force:!!selected?.recordId,consent:true})
      setConsent(null);setRunning(true)
    },preferences?.incremental===false?'已开始完整同步':'已开始增量识别')
  }
  async function retryQuestion(confirmed=false){
    const selected=detail||consent
    if(!selected)return
    if(!confirmed&&retryJobs.some(j=>j.state==='uncertain')){
      setConsent({retry:true,recordId:detail.record_id,generation:detail.source_generation});return
    }
    await action(async()=>{
      const result=await send('ocrDbRetryQuestion',{recordId:selected.record_id||selected.recordId,generation:selected.source_generation||selected.generation,confirmed})
      setDetail(null);setConsent(null)
      if(result.count){await send('ocrDbResume');setRunning(true)}
      setMessage(result.count?'已加入重试队列':'当前没有需要重试的任务')
    })
  }
  async function retryFailed(){
    await action(async()=>{
      const batch=await send('ocrDbRetryFailedBatch')
      if(!batch.count){setMessage('没有可重试的识别任务');return}
      setConsent({retry:true,batch})
    },'',false)
  }
  const counts=Object.fromEntries((stats?.states||[]).map(s=>[s.status,s.count])), completed=(counts.ready||0)+(counts.not_needed||0)
  const credentialRef=engine==='mineru'?settings?.mineru?.credentialRef:settings?.glmOcr?.credentialRef
  const credential=settings?.credentials?.[credentialRef]
  const provider=engine==='mineru'?'MinerU':'GLM-OCR', endpoint=engine==='mineru'?settings?.mineru?.baseUrl:settings?.glmOcr?.baseUrl
  async function chooseEngine(value){await action(async()=>{setSettings(await send('ocrSaveSettings',{ocrEngine:value}));setEngine(value)},'',false)}
  async function savePreference(patch,consent=false){await action(async()=>{setPreferences(await send('ocrDbSavePreferences',{...patch,consent,...(consent?{engine,notebookId:scope}:{})}));setMaintenance(null);onPreferencesChanged?.()},'',false)}
  async function selectBackup(){await action(async()=>{const value=await send('ocrDbSelectBackup');if(!value.cancelled)setMaintenance({kind:'import',...value})},'',false)}
  async function previewCleanup(){await action(async()=>setMaintenance({kind:'cleanup',...await send('ocrDbPreviewCleanup')}),'',false)}
  async function maintain(){
    const selected=maintenance
    if(selected.kind==='schedule'||selected.kind==='full'){await savePreference(selected.kind==='schedule'?{scheduled:true,intervalHours:selected.intervalHours}:{incremental:false},true);return}
    await action(async()=>{const value=await send(selected.kind==='import'?'ocrDbImportBackup':'ocrDbCleanup',{token:selected.token,confirmed:true});setMaintenance(null);if(selected.kind==='import'){setPreferences(await send('ocrDbGetPreferences'));setMessage(`已恢复 ${value.questions} 道题目`)}else setMessage(`已清理 ${value.questions} 条孤立记录、${value.assets} 张无引用图片`)})
  }
  useEffect(()=>{
    let stopped=false,inFlight=false
    async function tick(enter=false){if(inFlight)return;inFlight=true;try{const value=await send('ocrDbAutoTick',{enter});if(!stopped&&value.started){setRunning(true);setRefresh(n=>n+1)}}catch(reason){if(!stopped)fail(reason)}finally{inFlight=false}}
    void tick(true);const timer=setInterval(()=>{if(!document.hidden)void tick()},60000)
    return()=>{stopped=true;clearInterval(timer)}
  },[])
  useEffect(()=>{if(!message&&!error&&!searchError)return;const timer=setTimeout(()=>{setMessage('');setError('');setSearchError('')},5000);return()=>clearTimeout(timer)},[message,error,searchError])
  useEffect(()=>{if(!detail&&!consent&&!advanced&&!maintenance)return;const old=document.activeElement;const close=e=>{if(e.key==='Escape'){setDetail(null);setConsent(null);setAdvanced(false);setMaintenance(null)}if(e.key==='Tab'){const nodes=[...document.querySelectorAll('.ocrReference .modal-scrim.show button:not(:disabled),.ocrReference .modal-scrim.show textarea')];const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};document.querySelector('.ocrReference .modal-scrim.show button')?.focus();document.addEventListener('keydown',close);return()=>{document.removeEventListener('keydown',close);old?.focus?.()}},[!!detail,!!consent,advanced,!!maintenance])
  const pending=(counts.pending||0)+(counts.stale||0)+(counts.cancelled||0), coverage=stats?.total?100*completed/stats.total:0
  const originalView=original?.recordId===detail?.record_id?original:null
  const retryJobs=(detail?.jobs||[]).filter(j=>['failed','uncertain','cancelled'].includes(j.state))
  const latestError=retryJobs.find(j=>j.error)?.error
  const hasWork=running||stats?.running||stats?.sync?.running||stats?.sync?.resumable||(stats?.jobs||[]).some(j=>['pending','rendering','uploading','recognizing','downloading','normalizing'].includes(j.state))
  const row=(q,index,compact=false)=><button type="button" key={q.record_id} className={compact?'activity-row':'task-row'} onClick={()=>open(q.record_id)}>{compact?<span className={`row-icon ${q.status==='failed'?'failure':''}`}><RefIcon name={q.status==='failed'?'alert':q.status==='pending'?'clock':'check'}/></span>:<span className="task-num">{String(offset+index+1).padStart(2,'0')}</span>}<span className="row-data"><span className="row-title" style={{display:'block'}}>{q.title||'未命名错题'}</span></span><RefBadge state={q.status}/><RefIcon name="chevron"/></button>
  return <section className="ocrReference">
    <div className="window">
      <div className="ocrSticky"><header className="masthead">
        <div className="ocrPageBar"><button type="button" className="btn btn-ghost ocrBack" onClick={leave}><span aria-hidden="true">‹</span>返回错题管理</button><button type="button" className="btn btn-ghost" onClick={()=>setAdvanced(true)}>范围与服务地址</button></div>
        <div className="headline"><div className="mark"><RefIcon name="db"/></div><div className="headcopy"><h1>OCR 数据库</h1><p>题干识别与文本管理</p></div></div>
        <nav className="tabs" role="tablist" aria-label="OCR 管理导航">{[['overview','概览','db'],['tasks','任务','file'],['settings','设置','settings']].map(([key,title,icon],index)=><button type="button" className="tab" key={key} id={`ocr-tab-${key}`} role="tab" aria-selected={page===key} aria-controls={`ocr-panel-${key}`} tabIndex={page===key?0:-1} onClick={()=>setPage(key)} onKeyDown={e=>{const keys=['overview','tasks','settings'];const next=e.key==='ArrowRight'?keys[(index+1)%3]:e.key==='ArrowLeft'?keys[(index+2)%3]:e.key==='Home'?keys[0]:e.key==='End'?keys[2]:null;if(next){e.preventDefault();setPage(next);document.getElementById(`ocr-tab-${next}`)?.focus()}}}><RefIcon name={icon}/>{title}</button>)}</nav>
      </header>
      </div><section className="tabpane" id="ocr-panel-overview" role="tabpanel" aria-labelledby="ocr-tab-overview" hidden={page!=='overview'}>
        <div className="section-head"><h2 className="section-title">数据库概览</h2></div>
        <div className="card"><div className="stats">{[['check','可搜索',completed],['clock','待识别',pending],['alert','识别失败',counts.failed||0]].map(([icon,title,value])=><div className="stat" key={title}><div className="stat-label"><RefIcon name={icon}/>{title}</div><div className={`stat-num ${icon==='alert'?'failed':''}`}>{value.toLocaleString('zh-CN')}</div></div>)}</div>
          <div className="progress-section"><div className="row"><span className="progress-label">识别覆盖率</span><span className="progress-meta">{coverage.toFixed(1)}%</span></div><div className="progress-bg" role="progressbar" aria-label="OCR 识别覆盖率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(coverage.toFixed(1))}><div className="progress-fill" style={{width:`${coverage}%`}}/></div><div className="row" style={{marginTop:8}}><span className="section-sub">共 {(stats?.total||0).toLocaleString('zh-CN')} 道错题</span></div><div className="main-actions"><button type="button" className="btn btn-primary" disabled={busy||running} onClick={()=>setConsent({})}><RefIcon name="refresh"/>{preferences?.incremental===false?'完整同步':'增量识别'}</button><button type="button" className="btn btn-outline" disabled={busy||running} onClick={retryFailed}><RefIcon name="retry"/>重试失败</button></div></div>
        </div>
      <div className="ocrQueueBar" role="region" aria-label="识别队列控制"><div><span className={`ocrQueueDot ${running?'active':''}`}/><strong>{running?'正在处理':stats?.paused?'已暂停':'识别队列'}</strong><small>{stats?.sync?.running?`同步 ${stats.sync.done} / ${stats.sync.total}`:`${pending} 待处理 · ${counts.failed||0} 失败`}</small></div><div className="ocrQueueActions">{running?<button className="btn btn-outline" onClick={pauseQueue}>暂停识别</button>:<button className="btn btn-primary" disabled={busy||!hasWork} onClick={resumeQueue}>继续识别</button>}<button className="btn btn-outline ocrCancel" disabled={busy||!hasWork} onClick={cancelQueue}>取消队列</button></div></div>
        <div className="section-head"><h2 className="section-title">需要处理</h2><button type="button" className="text-btn" onClick={()=>{setPage('tasks');setFilter('');setQuery('');setOffset(0)}}>查看全部 <RefIcon name="chevron"/></button></div><div className="card activity">{attention.length?attention.map((q,i)=>row(q,i,true)):<div className="empty">暂无需要处理的题目</div>}</div>
      </section>
      <section className="tabpane" id="ocr-panel-tasks" role="tabpanel" aria-labelledby="ocr-tab-tasks" hidden={page!=='tasks'}>
        <div className="section-head"><h2 className="section-title">识别任务</h2></div><div className="search-box"><RefIcon name="search"/><input className="search-input" type="search" placeholder="搜索题名、题干、公式或记录 ID" aria-label="搜索题目" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/></div>
        <div className="filters" role="group" aria-label="任务状态筛选">{[['','全部'],['pending','待识别'],['failed','失败'],['ready','已完成']].map(([key,title])=><button type="button" key={key} className={`filter ${key==='failed'?'failed-filter':''}`} aria-pressed={filter===key} onClick={()=>{setFilter(key);setOffset(0)}}>{title}</button>)}</div>
        <div className="table-caption"><span>{stats?.preview?'示例题目':'题目'} · {result.total} 条</span></div><div className="card task-list">{result.items.length?result.items.map((q,i)=>row(q,i)):<div className="empty">未找到符合条件的题目</div>}</div>
        {result.total>30&&<div className="pagination"><button className="btn btn-outline btn-sm" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-30))}>上一页</button><span>{Math.floor(offset/30)+1} / {Math.ceil(result.total/30)}</span><button className="btn btn-outline btn-sm" disabled={offset+30>=result.total} onClick={()=>setOffset(n=>n+30)}>下一页</button></div>}
      </section>
      <section className="tabpane" id="ocr-panel-settings" role="tabpanel" aria-labelledby="ocr-tab-settings" hidden={page!=='settings'}>
        <div className="settings-group"><h2>识别引擎</h2><div className="radio-grid" role="radiogroup" aria-label="默认识别引擎">{[['glm-ocr','GLM-OCR'],['mineru','MinerU']].map(([key,title])=><label key={key} className={`radio-card ${engine===key?'selected':''}`}><input type="radio" name="engine" value={key} checked={engine===key} disabled={busy||!settings} onChange={()=>chooseEngine(key)}/><div className="radio-top"><span className="radio-control"/>{title}</div></label>)}</div>
          <div className="subsection-head">API 密钥</div><OCRCredential key={credentialRef} provider={provider} credentialRef={credentialRef} credential={credential} send={send} onSaved={async()=>{await loadSettings();onPreferencesChanged?.()}} onError={fail} Morph={Morph}/>
        </div>
        <div className="settings-group"><h2>识别行为</h2>{[['incremental','增量识别'],['autoRetry','失败任务自动重试'],['scheduled','定期自动 OCR']].map(([key,title])=><div className="setting-row" key={key}><div className="setting-name">{title}</div><button className="switch" type="button" role="switch" aria-checked={!!preferences?.[key]} aria-label={title} disabled={busy||!preferences} onClick={()=>{if(key==='scheduled'&&!preferences.scheduled)setMaintenance({kind:'schedule',intervalHours:24});else if(key==='incremental'&&preferences.incremental)setMaintenance({kind:'full'});else void savePreference({[key]:!preferences[key]})}}><span aria-hidden="true">{Switch?<Switch checked={!!preferences?.[key]} label={title}/>:<span className="switch-knob"/>}</span></button></div>)}</div>
        <div className="settings-group"><div className="row" style={{marginBottom:12}}><h2 style={{margin:0}}>本地数据库</h2></div><div className="card"><div className="db-info row"><div><strong className="db-size">{stats?.databaseBytes!=null?`${(stats.databaseBytes/1048576).toFixed(1)} MB`:'—'}</strong><div className="row-desc">cardlink-ocr.sqlite</div></div></div>
          <div className="db-row"><div><div className="db-row-title">检查数据库</div></div><button type="button" className="btn btn-outline btn-sm" disabled={busy||running} onClick={()=>action(()=>send('ocrDbCapabilities'),'数据库检查通过')}>检查</button></div>
          <div className="db-row"><div><div className="db-row-title">重建全文索引</div></div><button type="button" className="btn btn-outline btn-sm" disabled={busy||running} onClick={()=>action(()=>send('ocrDbRebuildSearch'),'搜索索引已重建')}>重建</button></div>
          <div className="db-row"><div className="db-row-title">备份数据库</div><button type="button" className="btn btn-outline btn-sm" disabled={busy||running} onClick={()=>action(async()=>{const value=await send('ocrDbBackup');setMessage(`已生成 ${value.filename}，请选择保存位置`)})}>备份</button></div>
          <div className="db-row"><div className="db-row-title">导入备份数据库</div><button type="button" className="btn btn-outline btn-sm" disabled={busy||running} onClick={selectBackup}>导入</button></div>
          <div className="db-row"><div className="db-row-title">清理孤立记录</div><button type="button" className="btn btn-outline btn-sm" disabled={busy||running} onClick={previewCleanup}>预览</button></div>
        </div></div>
      </section>
    </div>
    {maintenance&&<div className="modal-scrim show" onClick={e=>{if(e.target===e.currentTarget)setMaintenance(null)}}><div className="dialog" role="dialog" aria-modal="true" aria-label={maintenance.kind==='import'?'导入 OCR 备份':maintenance.kind==='cleanup'?'清理孤立记录':maintenance.kind==='schedule'?'定期自动 OCR':'完整识别'}><div className="row"><h2>{maintenance.kind==='import'?'导入 OCR 备份':maintenance.kind==='cleanup'?'清理孤立记录':maintenance.kind==='schedule'?'定期自动 OCR':'完整识别'}</h2><button className="btn btn-ghost btn-sm" onClick={()=>setMaintenance(null)}>关闭</button></div>
      <div className="body">{maintenance.kind==='import'?`备份含 ${maintenance.questions} 道题目、${maintenance.assets} 张图片。确认后替换当前 OCR 数据库，保留错题本与密钥。导入任务不会自动提交。`:maintenance.kind==='cleanup'?`将清理 ${maintenance.questions} 条已不在错题本的记录、${maintenance.assets} 张无引用图片；保留现有题目及其历史任务。`:maintenance.kind==='schedule'?`使用 ${provider}（${endpoint}），范围：${sets.find(s=>s.id===scope)?.title||'全部错题'}。工作台打开或刷新时增量检查新增和变更题干；OCR 数据库页还会按设定间隔检查。图片会发送至服务方，可能产生费用。`:'关闭后，每次同步都重新识别范围内的图片题，可能重复产生服务费用；人工修订保留。'}</div>
      {maintenance.kind==='schedule'&&<label className="fieldlabel">执行间隔<Select aria-label="自动 OCR 间隔" value={maintenance.intervalHours} onChange={e=>setMaintenance(m=>({...m,intervalHours:Number(e.target.value)}))}>{[[1,'每小时'],[6,'每 6 小时'],[24,'每天']].map(([value,title])=><option key={value} value={value}>{title}</option>)}</Select></label>}
      <div className="dialog-actions"><button className="btn btn-outline" disabled={busy} onClick={()=>setMaintenance(null)}>取消</button><button className="btn btn-primary" disabled={busy||(maintenance.kind==='cleanup'&&!maintenance.questions&&!maintenance.assets)} onClick={maintain}>{maintenance.kind==='import'?'确认导入':maintenance.kind==='cleanup'?'确认清理':'确认开启'}</button></div></div></div>}
    {advanced&&<div className="modal-scrim show"><div className="dialog" role="dialog" aria-modal="true" aria-label="同步范围与服务地址"><div className="row"><h2>同步范围与服务地址</h2><button className="btn btn-ghost btn-sm" onClick={()=>setAdvanced(false)}>关闭</button></div><label className="fieldlabel">题目范围<Select aria-label="题目范围" value={scope} onChange={e=>{setScope(e.target.value);setOffset(0)}}><option value="">全部错题</option>{sets.map(set=><option key={set.id} value={set.id}>{set.title}</option>)}</Select></label><label className="fieldlabel">服务地址<input className="search-input" aria-label="OCR 服务地址" value={endpoint||''} onChange={e=>setSettings(s=>({...s,[engine==='mineru'?'mineru':'glmOcr']:{...s[engine==='mineru'?'mineru':'glmOcr'],baseUrl:e.target.value}}))}/></label><div className="dialog-actions"><button className="btn btn-primary" disabled={busy||!settings} onClick={()=>action(async()=>{setSettings(await send('ocrSaveSettings',{mineru:settings.mineru,glmOcr:settings.glmOcr}));setAdvanced(false)},'服务设置已保存')}>保存</button></div></div></div>}
    {(detail||consent)&&<div className="modal-scrim show" onClick={e=>{if(e.target===e.currentTarget){setDetail(null);setConsent(null)}}}><div className={`dialog ${originalView?'ocrOriginalDialog':''}`} role="dialog" aria-modal="true" aria-label={consent?(consent.retry?'确认重试':'确认识别范围'):'题目识别文本'}><div className="row"><div><h2>{consent?(consent.retry?(consent.batch?'批量重试':'重试这道题'):consent.recordId?'重新识别这道题':'识别所选错题'):detail.title}</h2>{detail&&<div className="meta">{detail.record_id} · {labels[detail.status]||detail.status}</div>}</div><button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setDetail(null);setConsent(null)}}>关闭</button></div>
      {consent?<><div className="body">{consent.retry?(consent.batch?`将重试 ${consent.batch.questions} 道题。${consent.batch.uncertain?`其中 ${consent.batch.uncertain} 项提交结果待确认，重新提交可能重复计费。`:''}`:'这道题有提交结果不确定的识别任务。再次提交可能重复计费，是否继续？'):<>含图片的题干将发送至 {provider}（{endpoint}），可能产生服务费用。原生文字直接入库；不包含评论、子卡片答案或手写作答。人工修订将保留。</>}</div><div className="dialog-actions"><button className="btn btn-outline" onClick={()=>setConsent(null)}>取消</button><button className="btn btn-primary" disabled={busy} onClick={start}>{consent.retry?'确认重试':'确认并开始'}</button></div></>:<>
        <div className={`ocrDetailPreview ${originalView?'withOriginal':''}`}>
          {originalView&&<section className="ocrOriginalImages" aria-label="题目原图">
            {originalView.loading?<p role="status">正在读取原图…</p>:originalView.error?<p role="alert">{originalView.error}</p>:originalView.images.length?originalView.images.map((src,index)=><img key={index} src={src} alt={`题目原图 ${index+1}`} />):<p>这道题没有题干图片</p>}
          </section>}
          <section className="ocrTextPreview">
            <div className="topNav ocrPreviewTabs" role="group" aria-label="题干显示方式">
              <span className="topNavSlider" aria-hidden="true" style={{width:'50%',transform:`translateX(${textMode==='raw'?0:100}%)`}} />
              {[['raw','原始'],['rendered','渲染']].map(([mode,label])=><button type="button" key={mode} className={textMode===mode?'active':''} aria-pressed={textMode===mode} onClick={()=>setTextMode(mode)}><strong>{label}</strong></button>)}
            </div>
            {textMode==='raw'?<textarea aria-label="编辑题干文本" value={draft} onChange={e=>setDraft(e.target.value)}/>:<OCRRenderedPreview text={draft}/>}
          </section>
        </div>
        <div className="dialog-actions"><button className="btn btn-outline" disabled={originalView?.loading} onClick={()=>originalView&&!originalView.error?setOriginal(null):showOriginal(detail.record_id)}>{originalView&&!originalView.error?'隐藏原图':'显示原图'}</button>{retryJobs.length?<button className="btn btn-primary" disabled={busy||running} onClick={()=>retryQuestion()}>重试识别</button>:<button className="btn btn-outline" disabled={busy||running} onClick={()=>{setConsent({recordId:detail.record_id});setDetail(null)}}>重新识别</button>}<button className="btn btn-outline" disabled={busy||detail.manual_text===null} onClick={()=>action(async()=>{const q=await send('ocrDbEditQuestion',{recordId:detail.record_id,revision:detail.revision,text:null});setDetail(q);setDraft(q.effective_text);onIndexed?.()},'已恢复识别文本')}>恢复识别文本</button><button className={`btn ${retryJobs.length?'btn-outline':'btn-primary'}`} disabled={busy||draft===detail.effective_text} onClick={()=>action(async()=>{setDetail(await send('ocrDbEditQuestion',{recordId:detail.record_id,revision:detail.revision,text:draft}));onIndexed?.()},'人工修订已保存')}>保存修订</button></div>{latestError&&<p className="ocrLatestError" role="status">{latestError}</p>}</>}
    </div></div>}
    {(message||error||searchError)&&<div className={`toast show ${error||searchError?'error':''}`} role={error||searchError?'alert':'status'}>{error||searchError||message}</div>}
    {capture&&<OCRCapture key={capture.lease} item={capture} onDone={()=>{captureRef.current=null;setCapture(null)}} onError={fail}/>}
  </section>
}

function RefBadge({state}){const complete=['ready','not_needed'].includes(state);const variant=state==='failed'||state==='uncertain'?'destructive':state==='pending'||state==='stale'?'secondary':complete?'outline':'default';return <span className={`badge badge-${variant}`}>{complete?'已完成':state==='pending'||state==='stale'?'待识别':labels[state]||state}</span>}

const referenceIcons={"db": "<ellipse cx=\"12\" cy=\"5\" rx=\"8.5\" ry=\"3.5\"/><path d=\"M3.5 5v7c0 2 3.8 3.5 8.5 3.5s8.5-1.5 8.5-3.5V5M3.5 12v7c0 2 3.8 3.5 8.5 3.5s8.5-1.5 8.5-3.5v-7\"/>", "refresh": "<path d=\"M20 7v5h-5M4 17v-5h5\"/><path d=\"M5.6 9a7 7 0 0 1 12.4-2l2 5M4 12l2 5a7 7 0 0 0 12.4-2\"/>", "search": "<circle cx=\"10.8\" cy=\"10.8\" r=\"7.3\"/><path d=\"m16.3 16.3 4.2 4.2\"/>", "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.2 15.2 21 16l-2 3.5-1.7-.9a8 8 0 0 1-2.1 1.2L15 22h-4l-.3-2.2a8 8 0 0 1-2.1-1.2L7 19.5 5 16l1.8-.8a8 8 0 0 1 0-2.4L5 12l2-3.5 1.7.9a8 8 0 0 1 2.1-1.2L11 6h4l.3 2.2a8 8 0 0 1 2.1 1.2l1.6-.9L21 12l-1.8.8a8 8 0 0 1 0 2.4z\" transform=\"translate(0 -1) scale(1 .95)\"/>", "alert": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7.5v5.5M12 16.7h.01\"/>", "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>", "check": "<path d=\"m5 12 4.5 4.5L19 7\"/>", "chevron": "<path d=\"m9 6 6 6-6 6\"/>", "file": "<path d=\"M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6\"/>", "spark": "<path d=\"m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8zM19 17l.6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6z\"/>", "retry": "<path d=\"M20 6v6h-6M4 18v-6h6\"/><path d=\"M5.7 9a7 7 0 0 1 12.4-1.6L20 12M4 12l2 4a7 7 0 0 0 12.3-1.5\"/>", "lock": "<rect x=\"4\" y=\"10\" width=\"16\" height=\"11\" rx=\"2\"/><path d=\"M8 10V7a4 4 0 0 1 8 0v3\"/>"}
function RefIcon({name}){return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{__html:referenceIcons[name]||referenceIcons.file}}/>}
