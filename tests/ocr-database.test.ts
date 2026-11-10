import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { OCRStore, type SQLDriver, type OCRConfig, type SourceQuestion } from '../src/ocr-store'
import { sha256Bytes } from '../src/content-fingerprint'

function database(path=':memory:') {
  const raw = new DatabaseSync(path)
  const db:SQLDriver = {exec(sql,args=[]){raw.prepare(sql).run(...args)}, rows(sql,args=[]){return raw.prepare(sql).all(...args)},close(){raw.close()}}
  return new OCRStore(db)
}
const config:OCRConfig={engine:'glm-ocr',model:'glm-ocr',optionsHash:'options',baseUrl:'https://example.com'}
const source=(id='q1', overrides:Partial<SourceQuestion>={}):SourceQuestion=>({recordId:id,notebookId:'n1',noteId:id,title:'线性代数',metadata:'数学 矩阵',fingerprint:'f1',nativeText:'相似矩阵与正定矩阵',needsOCR:false,...overrides})

test('Unicode binding, restart persistence, real transaction rollback and FTS integrity',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cardlink-ocr-')),path=join(dir,'ocr.sqlite')
  let s=database(path)
  try {
    s.sync(source('q1',{nativeText:"O'Reilly 中文 😀 \\frac{1}{2}"}),config,1)
    assert.throws(()=>s.transaction(()=>{s.db.exec('DELETE FROM ocr_questions');throw Error('disk failure')}))
    s.db.close();s=database(path)
    assert.equal(s.question('q1').native_text,"O'Reilly 中文 😀 \\frac{1}{2}")
    assert.equal(s.integrity().ok,true)
  }finally{s.db.close();rmSync(dir,{recursive:true})}
})
test('source validation survives reopening SQLite and is cleared by source changes or backup restore',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cardlink-ocr-')),path=join(dir,'ocr.sqlite')
  let s=database(path)
  try {
    s.sync(source(),undefined,0)
    assert.equal(s.sourceIsCurrent('q1','revision-1'),false)
    s.sync(source(),undefined,0,false,false,'revision-1')
    const backup=s.backup()
    s.db.close();s=database(path)
    assert.equal(s.sourceIsCurrent('q1','revision-1'),true)
    assert.equal(s.sourceIsCurrent('q1','revision-2'),false)
    s.sync(source('q1',{fingerprint:'f2'}),undefined,0)
    assert.equal(s.sourceIsCurrent('q1','revision-1'),false)
    s.sync(source(),undefined,0,false,false,'revision-1')
    s.restoreBackup(backup)
    assert.equal(s.sourceIsCurrent('q1','revision-1'),false)
    assert.deepEqual(s.searchContent('正定矩阵'),['q1'])
  }finally{s.db.close();rmSync(dir,{recursive:true})}
})
test('Chinese two-gram candidates require contiguous text; updates, deletes and rebuilding stay consistent',()=>{
  const s=database()
  s.sync(source(),config,1)
  s.sync(source('q2',{nativeText:'相似与似矩在不同段落，矩阵'}),config,1)
  assert.deepEqual(s.search('相似矩阵').items.map(x=>x.record_id),['q1'])
  assert.equal(s.search('正定').total,1)
  s.edit('q1',1,'人工修订：逆矩阵')
  assert.equal(s.search('正定').total,0)
  assert.equal(s.search('逆矩阵').total,1)
  assert.equal(s.search('" OR 1=1 --').total,0)
  s.db.exec('DELETE FROM ocr_questions WHERE record_id=?',['q1'])
  assert.equal(s.search('逆矩阵').total,0)
  assert.equal(s.rebuild().ok,true);s.db.close()
})
test('pagination is applied after full-scope matching and notebook filtering',()=>{
  const s=database()
  for(let i=0;i<85;i++)s.sync(source('q'+i,{notebookId:i<65?'n1':'n2'}),config,1)
  const pages=[0,30,60].map(offset=>s.search('正定',offset,30,'n1'))
  assert.equal(pages[0].total,65)
  assert.deepEqual(pages.map(p=>p.items.length),[30,30,5])
  assert.equal(new Set(pages.flatMap(p=>p.items.map(q=>q.record_id))).size,65);s.db.close()
})
test('ten unchanged syncs and model switch create no repeated recognition; manual edits survive OCR',()=>{
  const s=database(),q=source('q1',{needsOCR:true})
  for(let i=0;i<10;i++)s.sync(q,config,1)
  assert.equal(s.db.rows('SELECT * FROM ocr_jobs').length,1)
  const capture=s.claim(Date.now(),'capture')
  s.attach(capture.id,capture.lease,[{hash:'image',dataUri:'image-data'}])
  const j=s.claim(Date.now(),'recognize')
  s.edit('q1',1,'用户修订')
  s.finish(j.id,j.lease,'OCR 输出')
  assert.equal(s.question('q1').effective_text,'用户修订')
  assert.equal(s.question('q1').status,'ready')
  s.sync(q,{...config,engine:'mineru',optionsHash:'other'},1)
  assert.equal(s.db.rows('SELECT * FROM ocr_jobs').length,2)
  assert.equal(s.claim(Date.now(),'again'),undefined);s.db.close()
})
test('forcing a native-text question does not leave it waiting for a nonexistent OCR job',()=>{
  const s=database();s.sync(source(),config,1);s.sync(source(),config,2,true)
  assert.equal(s.question('q1').status,'not_needed')
  assert.equal(s.claim(Date.now(),'worker'),undefined);s.db.close()
})

test('multiple assets preserve order and shared bytes reuse cached results',()=>{
  const s=database()
  s.sync(source('q1',{needsOCR:true}),config,1)
  const c=s.claim(Date.now(),'c');s.attach(c.id,c.lease,[{hash:'a',dataUri:'a'},{hash:'b',dataUri:'b'}])
  const a=s.claim(Date.now(),'a'),b=s.claim(Date.now(),'b')
  s.finish(b.id,b.lease,'第二张');assert.notEqual(s.question('q1').status,'ready')
  s.finish(a.id,a.lease,'第一张');assert.equal(s.question('q1').ocr_text,'第一张\n\n第二张')
  s.sync(source('q2',{needsOCR:true}),config,1)
  const c2=s.claim(Date.now(),'c2');s.attach(c2.id,c2.lease,[{hash:'a',dataUri:'a'}])
  const reused=s.claim(Date.now(),'r');assert.equal(s.cached(reused).markdown,'第一张');s.db.close()
})
test('late results cannot overwrite changed sources, cancellations, or delete/re-add identities',()=>{
  const s=database()
  s.sync(source('q1',{needsOCR:true}),config,1)
  const c=s.claim(Date.now(),'c');s.attach(c.id,c.lease,[{hash:'a',dataUri:'a'}]);const j=s.claim(Date.now(),'j')
  s.sync(source('q1',{fingerprint:'f2',needsOCR:true,nativeText:'新原题'}),config,2)
  s.finish(j.id,j.lease,'旧结果');assert.equal(s.question('q1').ocr_text,'');assert.equal(s.cached(j).markdown,'旧结果')
  s.cancel();assert.equal(s.claim(Date.now(),'x'),undefined)
  const oldId=s.question('q1').id
  s.db.exec('DELETE FROM ocr_questions WHERE record_id=?',['q1'])
  s.sync(source('q1'),config,3);assert.notEqual(s.question('q1').id,oldId)
  s.finish(j.id,j.lease,'不能复活');assert.equal(s.question('q1').ocr_text,'');s.db.close()
})
test('interrupted requests are uncertain; saved remote jobs resume without losing remote ID',()=>{
  const s=database()
  s.sync(source('q1',{needsOCR:true}),config,1)
  const c=s.claim(Date.now(),'c');s.attach(c.id,c.lease,[{hash:'a',dataUri:'a'}]);const j=s.claim(Date.now(),'j')
  s.stage(j.id,j.lease,'uploading')
  s.claim(Date.now()+200000,'restart')
  assert.equal(s.job(j.id).state,'uncertain')
  assert.throws(()=>s.retry(j.id,false),/重复计费/)
  s.retry(j.id,true);const retry=s.claim(Date.now()+400000,'r')
  s.stage(retry.id,retry.lease,'recognizing','remote-batch')
  const recovered=s.claim(Date.now()+600000,'recovered')
  assert.equal(recovered.remote_id,'remote-batch');s.db.close()
})
test('revision guards reject stale edits, and SHA-256 hashes actual binary bytes',()=>{
  const s=database();s.sync(source(),config,1);s.edit('q1',1,'修订')
  assert.throws(()=>s.edit('q1',1,'过期覆盖'),/已更新/)
  const q=s.question('q1');s.edit('q1',q.revision,null);assert.equal(s.question('q1').effective_text,source().nativeText)
  const bytes=Uint8Array.from([0,128,255,64,33]);assert.equal(sha256Bytes(bytes),createHash('sha256').update(bytes).digest('hex'));s.db.close()
})

test('source changed back to an old fingerprint creates a new generation; previous jobs cannot be retried',()=>{
  const s=database()
  s.sync(source('q1',{needsOCR:true}),config,1)
  const old=s.claim(Date.now(),'old');s.cancel()
  s.sync(source('q1',{needsOCR:true,fingerprint:'f2'}),config,2)
  s.sync(source('q1',{needsOCR:true}),config,3)
  const fresh=s.claim(Date.now(),'new')
  assert.ok(fresh);assert.notEqual(fresh.id,old.id)
  assert.throws(()=>s.retry(old.id,true),/原题已变化/)
  s.attach(fresh.id,fresh.lease,[{hash:'a',dataUri:'a'}])
  const j=s.claim(Date.now(),'j');s.finish(j.id,j.lease,'新一轮识别')
  assert.equal(s.question('q1').status,'ready');s.db.close()
})

test('reference task filters group native completions and changed sources; record IDs are searchable',()=>{
  const s=database();s.sync(source('record-001'),config,1);s.sync(source('record-002',{needsOCR:true}),config,1)
  s.sync(source('record-002',{needsOCR:true,fingerprint:'f2'}),config,2)
  assert.equal(s.search('',0,30,'','completed').total,1)
  assert.equal(s.search('',0,30,'','waiting').total,1)
  assert.equal(s.search('record-001').items[0].record_id,'record-001');s.db.close()
})

test('suspended OCR jobs retain remote identity and can be claimed again without failure',()=>{
  const s=database();s.sync(source('q1',{needsOCR:true}),config,1)
  const c=s.claim(Date.now(),'capture');s.attach(c.id,c.lease,[{hash:'asset',dataUri:'data:image/jpeg;base64,aW1n'}])
  const task=s.claim(Date.now(),'first');s.stage(task.id,task.lease,'recognizing','batch-pause')
  s.suspend(task.id,task.lease);assert.equal(s.job(task.id).state,'pending');assert.equal(s.job(task.id).attempts,0)
  const resumed=s.claim(Date.now(),'second');assert.equal(resumed.remote_id,'batch-pause');assert.equal(resumed.id,task.id)
  s.cancel();s.suspend(resumed.id,resumed.lease);assert.equal(s.job(task.id).state,'cancelled');s.db.close()
})

test('question retry excludes historical generations and atomically confirms all current uncertain assets',()=>{
  const s=database(),input=source('q1',{needsOCR:true});s.sync(input,config,1)
  const old=s.claim(Date.now(),'old');s.fail(old.id,old.lease,'历史格式错误')
  s.sync(input,config,2,true);const capture=s.claim(Date.now(),'new');s.attach(capture.id,capture.lease,[{hash:'a',dataUri:'a'},{hash:'b',dataUri:'b'}])
  const a=s.claim(Date.now(),'a');s.fail(a.id,a.lease,'未知提交结果',true)
  const b=s.claim(Date.now(),'b');s.fail(b.id,b.lease,'HTTP 400')
  const q=s.question('q1');s.edit('q1',q.revision,'人工修订')
  assert.ok(s.currentJobs('q1').every(j=>j.id!==old.id))
  assert.throws(()=>s.retryQuestion('q1',q.source_generation,false),/重复计费/)
  assert.equal(s.job(a.id).state,'uncertain');assert.equal(s.job(b.id).state,'failed')
  assert.equal(s.retryQuestion('q1',q.source_generation,false,true).count,1)
  assert.equal(s.job(a.id).state,'uncertain');assert.equal(s.job(b.id).state,'pending')
  assert.equal(s.question('q1').status,'failed')
  assert.equal(s.retryQuestion('q1',q.source_generation,true).count,1)
  assert.equal(s.job(old.id).state,'cancelled');assert.equal(s.question('q1').effective_text,'人工修订')
  assert.equal(s.retryQuestion('q1',q.source_generation,true).count,0)
  assert.throws(()=>s.retryQuestion('q1',q.source_generation-1,true),/题目已更新/);s.db.close()
})


test('logical backup restores text, images, results and search without reviving uploads',()=>{
  const s=database();s.sync(source('text'),config,1);s.edit('text',1,'人工正文 😀')
  s.sync(source('picture',{needsOCR:true}),config,1);const capture=s.claim(Date.now(),'capture')
  s.attach(capture.id,capture.lease,[{hash:'image',dataUri:'data:image/jpeg;base64,aW1n'}]);const job=s.claim(Date.now(),'upload');s.stage(job.id,job.lease,'uploading')
  s.sync(source('finished',{needsOCR:true}),config,1);const readyCapture=s.claim(Date.now(),'ready-capture')
  s.attach(readyCapture.id,readyCapture.lease,[{hash:'ready-image',dataUri:'data:image/jpeg;base64,aW1n'}]);const ready=s.claim(Date.now(),'ready')
  s.db.exec('INSERT INTO ocr_results(asset_id,engine,model,options_hash,markdown,blocks_json) VALUES(?,?,?,?,?,?)',['ready-image','glm-ocr','glm-ocr','options','已识别正文','[]'])
  s.finish(ready.id,ready.lease,'已识别正文','[]')
  const backup=s.backup();assert.equal(backup.tables.ocr_assets.length,2)
  s.sync(source('later'),config,1);s.restoreBackup(backup)
  assert.equal(s.question('later'),undefined);assert.equal(s.question('text').effective_text,'人工正文 😀')
  assert.equal(s.search('人工正文').total,1);assert.equal(s.job(job.id).state,'uncertain');assert.equal(s.job(job.id).lease,'')
  assert.equal(s.question('finished').effective_text.includes('已识别正文'),true);assert.equal(s.db.rows('SELECT markdown FROM ocr_results')[0].markdown,'已识别正文')
  assert.equal(s.claim(Date.now(),'after-import'),undefined);assert.equal(s.integrity().ok,true)
  assert.ok(s.stats().databaseBytes>0);s.db.close()
})

test('corrupt backup restores nothing and rolls back the entire replacement',()=>{
  const s=database();s.sync(source(),config,1);const backup=s.backup()
  const bad=JSON.parse(JSON.stringify(backup));bad.tables.ocr_question_assets.push({question_id:999,asset_id:'missing',position:0})
  assert.throws(()=>s.restoreBackup(bad));assert.equal(s.question('q1').title,'线性代数');assert.equal(s.integrity().ok,true)
  const foreign=JSON.parse(JSON.stringify(backup));foreign.schemaVersion=2;assert.throws(()=>s.restoreBackup(foreign),/备份/)
  const extra=JSON.parse(JSON.stringify(backup));extra.tables.ocr_questions[0].rogue='x';assert.throws(()=>s.inspectBackup(extra),/字段/)
  s.db.close()
})

test('orphan cleanup preview rolls back and cleanup keeps live and historical referenced assets',()=>{
  const s=database();s.sync(source('live',{needsOCR:true}),config,1);const task=s.claim(Date.now(),'live')
  s.attach(task.id,task.lease,[{hash:'shared',dataUri:'image'}]);s.sync(source('gone'),config,1)
  s.db.exec('INSERT INTO ocr_assets(id,data_uri) VALUES(?,?)',['unused','orphan-image'])
  s.db.exec('INSERT INTO ocr_results(asset_id,engine,model,options_hash,markdown) VALUES(?,?,?,?,?)',['unused','glm-ocr','glm-ocr','o','unused'])
  const preview=s.orphanSummary(['live']);assert.equal(preview.questions,1);assert.equal(preview.assets,1)
  assert.ok(s.question('gone'));assert.equal(s.db.rows('SELECT id FROM ocr_assets').length,2)
  s.cleanOrphans(['live']);assert.equal(s.question('gone'),undefined);assert.equal(s.db.rows('SELECT id FROM ocr_assets')[0].id,'shared')
  assert.equal(s.integrity().ok,true);s.db.close()
})

test('list content search excludes titles and metadata, returns every hit and tracks manual revisions',()=>{
  const s=database()
  for(let i=0;i<85;i++)s.sync(source('body'+i,{nativeText:'ＡＢＣ 正定矩阵'}),config,1)
  s.sync(source('title-only',{title:'正定矩阵',nativeText:'其他题干'}),config,1)
  assert.equal(s.searchContent('正定矩阵').length,85)
  assert.equal(s.searchContent('abc').length,85)
  assert.equal(s.searchContent('阵').length,85)
  assert.deepEqual(s.searchContent('数学'),[])
  s.edit('body0',1,'修订为逆矩阵')
  assert.equal(s.searchContent('正定矩阵').length,84)
  assert.deepEqual(s.searchContent('逆矩阵'),['body0'])
  assert.deepEqual(s.searchContent(''),[])
  s.db.close()
})

test('bulk retry includes uncertain jobs and only applies the preview that was confirmed',()=>{
  const s=database()
  for(const id of ['a','b']){
    s.sync(source(id,{needsOCR:true}),config,1)
    const job=s.claim(Date.now(),'lease-'+id)
    s.fail(job.id,job.lease,'test failure',id==='b')
  }
  const live=new Set(['a','b']), preview=s.retryFailedBatch(live)
  assert.equal(preview.questions,2)
  assert.equal(preview.uncertain,1)
  assert.equal(s.currentJobs('b')[0].state,'uncertain')
  assert.throws(()=>s.retryFailedBatch(new Set(['a']),preview.signature),/任务已变化/)
  assert.equal(s.retryFailedBatch(live,preview.signature).count,2)
  assert.equal(s.currentJobs('a')[0].state,'pending')
  assert.equal(s.currentJobs('b')[0].state,'pending')
  s.db.close()
})

test('incremental recognition resumes incomplete work without repeating ready or uncertain jobs',()=>{
  const s=database()
  for(const id of ['ready','cancelled','failed','uncertain']){
    s.sync(source(id,{needsOCR:true}),config,1)
    const capture=s.claim(Date.now(),'capture-'+id)
    s.attach(capture.id,capture.lease,[{hash:id,dataUri:id}])
    const job=s.claim(Date.now(),'recognize-'+id)
    if(id==='ready')s.finish(job.id,job.lease,'done')
    else if(id==='cancelled')s.cancel()
    else if(id==='uncertain'){s.stage(job.id,job.lease,'uploading');s.cancel()}
    else s.fail(job.id,job.lease,'network failure')
  }
  for(const id of ['ready','cancelled','failed','uncertain'])s.sync(source(id,{needsOCR:true}),config,2,false,true)
  const state=(id:string)=>s.currentJobs(id)[0].state
  assert.equal(state('ready'),'ready')
  assert.equal(state('cancelled'),'pending')
  assert.equal(state('failed'),'pending')
  assert.equal(state('uncertain'),'uncertain')
  s.db.close()
})

test('mixed-script and formula substrings use the same candidate index in both searches', () => {
  const s = database()
  s.sync(source('mixed', { nativeText: '求 Ｚ 变换，说明 SN74LS161 计数器的 x ^ 2 + β。' }), config, 1)
  s.sync(source('separate', { nativeText: '变换；Z 变量；x^ 与 ^2+β 分列。' }), config, 1)
  for (const query of ['Z变换', '74LS161计数器', 'x^2+β', 'β']) {
    const expected = new Set(query === 'β' ? ['mixed','separate'] : ['mixed'])
    assert.deepEqual(new Set(s.search(query).items.map(item => item.record_id)), expected)
    assert.deepEqual(new Set(s.searchContent(query)), expected)
  }
  s.db.close()
})

test('opening a v1 SQLite index rebuilds derived grams without changing source or edits', () => {
  const dir=mkdtempSync(join(tmpdir(),'cardlink-ocr-')), path=join(dir,'ocr.sqlite')
  let s=database(path)
  try {
    s.sync(source(),config,1)
    s.edit('q1',s.question('q1').revision,'Z 变换')
    const before=s.question('q1')
    s.db.exec("UPDATE ocr_questions SET search_text='z 变换',search_grams='变换'")
    s.db.exec('PRAGMA user_version=1')
    s.db.close(); s=database(path)
    assert.deepEqual(s.searchContent('Z变换'),['q1'])
    for(const key of ['id','revision','updated_at','manual_text','source_fingerprint'])assert.equal(s.question('q1')[key],before[key])
    assert.equal(s.integrity().ok,true)
  } finally {s.db.close();rmSync(dir,{recursive:true})}
})
