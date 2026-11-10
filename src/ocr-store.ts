/** SQL is deliberately synchronous: no transaction may span a network await. */
export type SQLValue = string | number
export interface SQLDriver { exec(sql: string, args?: SQLValue[]): void; rows(sql: string, args?: SQLValue[]): any[]; close(): void }

export const OCR_SCHEMA = [
  `CREATE TABLE ocr_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL UNIQUE, notebook_id TEXT NOT NULL, note_id TEXT NOT NULL, title TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '', source_fingerprint TEXT NOT NULL, native_text TEXT NOT NULL DEFAULT '', ocr_text TEXT NOT NULL DEFAULT '', manual_text TEXT, effective_text TEXT NOT NULL DEFAULT '', search_text TEXT NOT NULL DEFAULT '', search_grams TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, source_generation INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE ocr_assets (id TEXT PRIMARY KEY, data_uri TEXT NOT NULL)`,
  `CREATE TABLE ocr_question_assets (question_id INTEGER NOT NULL REFERENCES ocr_questions(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES ocr_assets(id), position INTEGER NOT NULL, PRIMARY KEY(question_id,position))`,
  `CREATE TABLE ocr_results (asset_id TEXT NOT NULL REFERENCES ocr_assets(id), engine TEXT NOT NULL, model TEXT NOT NULL, options_hash TEXT NOT NULL, markdown TEXT NOT NULL, blocks_json TEXT NOT NULL DEFAULT '', PRIMARY KEY(asset_id,engine,model,options_hash))`,
  `CREATE TABLE ocr_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL REFERENCES ocr_questions(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, asset_id TEXT NOT NULL DEFAULT '', engine TEXT NOT NULL, model TEXT NOT NULL, options_hash TEXT NOT NULL, config_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', remote_id TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, lease TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', consent_at INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 1, UNIQUE(question_id,fingerprint,asset_id,engine,options_hash,generation))`,
  `CREATE INDEX ocr_jobs_state ON ocr_jobs(state,next_at)`,
  `CREATE TABLE ocr_sync_state (id INTEGER PRIMARY KEY CHECK(id=1), payload_json TEXT NOT NULL)`,
  `CREATE VIRTUAL TABLE ocr_question_fts USING fts5(search_text,search_grams,content='ocr_questions',content_rowid='id',tokenize='unicode61')`,
  `CREATE TRIGGER ocr_insert AFTER INSERT ON ocr_questions BEGIN INSERT INTO ocr_question_fts(rowid,search_text,search_grams) VALUES(new.id,new.search_text,new.search_grams); END`,
  `CREATE TRIGGER ocr_delete AFTER DELETE ON ocr_questions BEGIN INSERT INTO ocr_question_fts(ocr_question_fts,rowid,search_text,search_grams) VALUES('delete',old.id,old.search_text,old.search_grams); END`,
  `CREATE TRIGGER ocr_update AFTER UPDATE OF search_text,search_grams ON ocr_questions BEGIN INSERT INTO ocr_question_fts(ocr_question_fts,rowid,search_text,search_grams) VALUES('delete',old.id,old.search_text,old.search_grams); INSERT INTO ocr_question_fts(rowid,search_text,search_grams) VALUES(new.id,new.search_text,new.search_grams); END`,
  `PRAGMA user_version=2`
]

export function normalizedSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\\(?:left|right)\b/g, '').replace(/\s+/g, '')
}

function searchGrams(text: string): string[] {
  const characters = Array.from(text)
  const tokens = new Set<string>()
  for (let i = 1; i < characters.length; i++) {
    // Encode code points so unicode61 cannot split symbols or merge mixed scripts.
    tokens.add(`g${characters[i - 1].codePointAt(0)!.toString(16)}x${characters[i].codePointAt(0)!.toString(16)}`)
  }
  return [...tokens]
}

function searchMatch(value: string): string {
  // Any substring must contain every one of these bigrams. Verify order with instr.
  return searchGrams(value).slice(0, 32).map(token => `search_grams:${token}`).join(' AND ')
}
export interface SourceQuestion { recordId: string; notebookId: string; noteId: string; title: string; metadata: string; fingerprint: string; nativeText: string; needsOCR: boolean }
export interface OCRConfig { engine: 'glm-ocr' | 'mineru'; model: string; optionsHash: string; baseUrl: string; language?: string; formula?: boolean; table?: boolean; timeoutMs?: number }

const backupTables=['ocr_questions','ocr_assets','ocr_question_assets','ocr_results','ocr_jobs'] as const
const rollbackPreview=new Error('preview rollback')

export class OCRStore {
  constructor(readonly db: SQLDriver) {
    db.exec('PRAGMA foreign_keys=ON')
    const version = Number(db.rows('PRAGMA user_version')[0]?.user_version || 0)
    if (version > 2) throw new Error('OCR 数据库来自更新版本，请升级插件')
    if (!version) this.transaction(() => OCR_SCHEMA.forEach(sql => db.exec(sql)))
    if (version === 1) this.transaction(() => {
      for (const q of db.rows('SELECT id FROM ocr_questions')) this.refreshText(q.id, false)
      db.exec('PRAGMA user_version=2')
    })
    // Derived state stays outside the portable OCR backup and follows question deletion.
    db.exec('CREATE TABLE IF NOT EXISTS ocr_source_revisions (question_id INTEGER PRIMARY KEY REFERENCES ocr_questions(id) ON DELETE CASCADE, source_revision TEXT NOT NULL)')
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result }
    catch (error) { try { this.db.exec('ROLLBACK') } catch {} throw error }
  }
  question(recordId: string) { return this.db.rows('SELECT * FROM ocr_questions WHERE record_id=?', [recordId])[0] }
  sourceIsCurrent(recordId: string, revision: string) {
    return this.db.rows("SELECT 1 FROM ocr_questions q JOIN ocr_source_revisions r ON r.question_id=q.id WHERE q.record_id=? AND r.source_revision=? AND q.status<>'stale'", [recordId,revision]).length > 0
  }
  job(id: number) { return this.db.rows('SELECT j.*,q.record_id FROM ocr_jobs j JOIN ocr_questions q ON q.id=j.question_id WHERE j.id=?', [id])[0] }
  refreshText(id: number, updateTime = true) {
    const q = this.db.rows('SELECT * FROM ocr_questions WHERE id=?', [id])[0]
    const effective = q.manual_text === null ? [q.native_text, q.ocr_text].filter(Boolean).join('\n\n') : q.manual_text
    const search = [q.record_id, q.title, q.metadata, effective].map(normalizedSearch).join('\n')
    this.db.exec('UPDATE ocr_questions SET effective_text=?,search_text=?,search_grams=?,updated_at=? WHERE id=?', [effective, search, searchGrams(search).join(' '), updateTime ? Date.now() : q.updated_at, id])
  }
  sync(source: SourceQuestion, config: OCRConfig | undefined, consentAt: number, force = false, resumeIncomplete = false, sourceRevision?: string) {
    return this.transaction(() => {
      const old = this.question(source.recordId), changed = !old || old.source_fingerprint !== source.fingerprint
      const queue = source.needsOCR && config && (changed || force ||
        (old && !this.currentJobs(source.recordId).length && ['pending','stale'].includes(old.status)))
      if (!changed && !force && !queue && !resumeIncomplete && old.title === source.title && old.metadata === source.metadata) {
        if (sourceRevision) this.db.exec('INSERT OR REPLACE INTO ocr_source_revisions VALUES(?,?)', [old.id,sourceRevision])
        return old
      }
      if (!old) this.db.exec('INSERT INTO ocr_questions(record_id,notebook_id,note_id,title,metadata,source_fingerprint,native_text,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', [source.recordId,source.notebookId,source.noteId,source.title,source.metadata,source.fingerprint,source.nativeText,source.needsOCR ? 'pending' : 'not_needed',Date.now()])
      else this.db.exec('UPDATE ocr_questions SET title=?,metadata=?,native_text=?,source_fingerprint=?,revision=revision+?,source_generation=source_generation+?,status=? WHERE id=?', [source.title,source.metadata,source.nativeText,source.fingerprint,changed ? 1 : 0,(changed || force) ? 1 : 0,changed ? (source.needsOCR ? 'stale' : 'not_needed') : force ? (source.needsOCR ? 'pending' : 'not_needed') : old.status,old.id])
      const q = this.question(source.recordId)
      if (changed) {
        this.db.exec("UPDATE ocr_jobs SET state='stale',lease='' WHERE question_id=? AND state NOT IN ('ready','cancelled')", [q.id])
        this.db.exec('DELETE FROM ocr_question_assets WHERE question_id=?', [q.id])
        this.db.exec("UPDATE ocr_questions SET ocr_text='' WHERE id=?", [q.id])
      }
      if (queue && config) {
        if (force) {
          this.db.exec("UPDATE ocr_jobs SET state='cancelled',lease='' WHERE question_id=? AND state NOT IN ('ready','stale')", [q.id])
          // A deliberate rerun is a new recognition configuration, not a cache hit.
        }
        this.db.exec('INSERT OR IGNORE INTO ocr_jobs(question_id,fingerprint,engine,model,options_hash,config_json,consent_at,generation) VALUES(?,?,?,?,?,?,?,?)', [q.id,source.fingerprint,config.engine,config.model,config.optionsHash,JSON.stringify(config),consentAt,q.source_generation])
      }
      if (resumeIncomplete && !changed && !force && source.needsOCR && !['ready','not_needed'].includes(q.status)) {
        const jobs = this.currentJobs(source.recordId)
        for (const job of jobs) {
          if (job.state !== 'cancelled' && job.state !== 'failed') continue
          this.db.exec("UPDATE ocr_jobs SET state='pending',lease='',lease_until=0,error='',next_at=0 WHERE id=?", [job.id])
        }
        if (jobs.some(job => job.state === 'cancelled' || job.state === 'failed') && !jobs.some(job => job.state === 'uncertain')) {
          this.db.exec("UPDATE ocr_questions SET status='pending' WHERE id=?", [q.id])
        }
      }
      this.refreshText(q.id)
      if (sourceRevision) this.db.exec('INSERT OR REPLACE INTO ocr_source_revisions VALUES(?,?)', [q.id,sourceRevision])
      else this.db.exec('DELETE FROM ocr_source_revisions WHERE question_id=?', [q.id])
      return this.question(source.recordId)
    })
  }
  edit(recordId: string, revision: number, value: string | null) {
    return this.transaction(() => {
      const q = this.question(recordId)
      if (!q || q.revision !== revision) throw new Error('题目已更新，请重新打开后编辑')
      if (value === null) this.db.exec('UPDATE ocr_questions SET manual_text=NULL,revision=revision+1 WHERE id=?', [q.id])
      else this.db.exec('UPDATE ocr_questions SET manual_text=?,revision=revision+1 WHERE id=?', [value,q.id])
      this.refreshText(q.id); return this.question(recordId)
    })
  }
  /** Complete ID results for the list; only effective question text is matched. */
  searchContent(query: string): string[] {
    const value = normalizedSearch(query)
    if (!value) return []
    const match = searchMatch(value)
    const candidates = match ? 'id IN (SELECT rowid FROM ocr_question_fts WHERE ocr_question_fts MATCH ?) AND ' : ''
    return this.db.rows(`SELECT record_id,effective_text FROM ocr_questions WHERE ${candidates}instr(search_text,?)>0`, match ? [match,value] : [value])
      .filter(q => normalizedSearch(q.effective_text).includes(value)).map(q => String(q.record_id))
  }
  search(query: string, offset = 0, limit = 30, notebookId = '', status = '') {
    const value = normalizedSearch(query), match = searchMatch(value), args: SQLValue[] = [], where = ['1=1']
    if (match) { where.push('q.id IN (SELECT rowid FROM ocr_question_fts WHERE ocr_question_fts MATCH ?)'); args.push(match) }
    if (value) { where.push('instr(q.search_text,?)>0'); args.push(value) }
    if (notebookId) { where.push('q.notebook_id=?'); args.push(notebookId) }
    if (status === 'completed') where.push("q.status IN ('ready','not_needed')")
    else if (status === 'waiting') where.push("q.status IN ('pending','stale','cancelled')")
    else if (status) { where.push('q.status=?'); args.push(status) }
    const clause = where.join(' AND ')
    const total = Number(this.db.rows(`SELECT count(*) AS count FROM ocr_questions q WHERE ${clause}`, args)[0].count)
    const items = this.db.rows(`SELECT q.record_id,q.title,q.status,q.updated_at,q.manual_text IS NOT NULL AS edited,substr(q.effective_text,1,160) AS excerpt FROM ocr_questions q WHERE ${clause} ORDER BY q.updated_at DESC,q.id DESC LIMIT ? OFFSET ?`, [...args,Math.max(1,Math.min(50,limit)),Math.max(0,offset)])
    return { items,total }
  }
  stats() {
    return { total: Number(this.db.rows('SELECT count(*) AS n FROM ocr_questions')[0].n), states: this.db.rows('SELECT status,count(*) AS count FROM ocr_questions GROUP BY status'), jobs: this.db.rows('SELECT j.state,count(*) AS count FROM ocr_jobs j JOIN ocr_questions q ON q.id=j.question_id AND q.source_generation=j.generation AND q.source_fingerprint=j.fingerprint GROUP BY j.state'), schemaVersion: 2, databaseBytes:Number(Object.values(this.db.rows('PRAGMA page_count')[0])[0])*Number(Object.values(this.db.rows('PRAGMA page_size')[0])[0]) }
  }
  claim(now: number, lease: string, consentAt?: number) {
    return this.transaction(() => {
      // Unknown POST outcomes are never automatically submitted again.
      this.db.exec("UPDATE ocr_jobs SET state=CASE WHEN asset_id='' OR remote_id<>'' THEN 'pending' ELSE 'uncertain' END,error='上次运行中断，请检查任务状态',lease='' WHERE lease_until<? AND state IN ('rendering','uploading','recognizing','downloading','normalizing')", [now])
      this.db.exec("UPDATE ocr_questions SET status='failed' WHERE EXISTS(SELECT 1 FROM ocr_jobs j WHERE j.question_id=ocr_questions.id AND j.generation=ocr_questions.source_generation AND j.state='uncertain')")
      const j = this.db.rows(`SELECT * FROM ocr_jobs WHERE state='pending' AND next_at<=?${consentAt === undefined ? '' : ' AND consent_at=?'} ORDER BY id LIMIT 1`, consentAt === undefined ? [now] : [now,consentAt])[0]
      if (!j) return undefined
      this.db.exec('UPDATE ocr_jobs SET state=?,lease=?,lease_until=? WHERE id=?', [j.asset_id ? 'recognizing' : 'rendering',lease,now + 180000,j.id])
      return this.job(j.id)
    })
  }
  releaseCapture(id: number, lease: string) {
    this.db.exec("UPDATE ocr_jobs SET state='pending',lease='',lease_until=0 WHERE id=? AND lease=? AND state='rendering'", [id,lease])
  }
  active(id: number, lease: string) { const j = this.job(id); return j && j.lease === lease && !['cancelled','stale','ready','failed','uncertain'].includes(j.state) ? j : undefined }
  stage(id: number, lease: string, state: string, remoteId?: string) {
    if (!this.active(id, lease)) throw new Error('OCR 任务已取消或过期')
    if (remoteId !== undefined) this.db.exec('UPDATE ocr_jobs SET state=?,remote_id=?,lease_until=? WHERE id=? AND lease=?', [state,remoteId,Date.now()+180000,id,lease])
    else this.db.exec('UPDATE ocr_jobs SET state=?,lease_until=? WHERE id=? AND lease=?', [state,Date.now()+180000,id,lease])
  }
  attach(id: number, lease: string, assets: { hash: string; dataUri: string }[]) {
    this.transaction(() => {
      const j = this.active(id,lease); if (!j) throw new Error('OCR 截图任务已过期')
      this.db.exec('DELETE FROM ocr_question_assets WHERE question_id=?', [j.question_id])
      assets.forEach((asset,position) => {
        this.db.exec('INSERT OR IGNORE INTO ocr_assets(id,data_uri) VALUES(?,?)', [asset.hash,asset.dataUri])
        this.db.exec('INSERT INTO ocr_question_assets(question_id,asset_id,position) VALUES(?,?,?)', [j.question_id,asset.hash,position])
        this.db.exec('INSERT OR IGNORE INTO ocr_jobs(question_id,fingerprint,asset_id,engine,model,options_hash,config_json,consent_at,generation) VALUES(?,?,?,?,?,?,?,?,?)', [j.question_id,j.fingerprint,asset.hash,j.engine,j.model,j.options_hash,j.config_json,j.consent_at,j.generation])
      })
      this.db.exec("UPDATE ocr_jobs SET state='ready',lease='' WHERE id=?", [id])
    })
  }
  cached(j: any) { return this.db.rows('SELECT * FROM ocr_results WHERE asset_id=? AND engine=? AND model=? AND options_hash=?', [j.asset_id,j.engine,j.model,j.options_hash])[0] }
  finish(id: number, lease: string, markdown: string, blocks = '') {
    this.transaction(() => {
      const j = this.job(id); if (!j) return
      this.db.exec('INSERT OR REPLACE INTO ocr_results(asset_id,engine,model,options_hash,markdown,blocks_json) VALUES(?,?,?,?,?,?)', [j.asset_id,j.engine,j.model,j.options_hash,markdown,blocks])
      if (!this.active(id,lease)) return
      const q = this.question(j.record_id)
      if (q.source_fingerprint !== j.fingerprint || q.source_generation !== j.generation) { this.db.exec("UPDATE ocr_jobs SET state='stale',lease='' WHERE id=?", [id]); return }
      this.db.exec("UPDATE ocr_jobs SET state='ready',lease='',error='' WHERE id=?", [id])
      const missing = this.db.rows("SELECT count(*) AS n FROM ocr_jobs WHERE question_id=? AND fingerprint=? AND engine=? AND options_hash=? AND generation=? AND asset_id<>'' AND state<>'ready'", [q.id,j.fingerprint,j.engine,j.options_hash,j.generation])[0].n
      if (!Number(missing)) {
        const parts = this.db.rows('SELECT r.markdown FROM ocr_question_assets a JOIN ocr_results r ON r.asset_id=a.asset_id AND r.engine=? AND r.model=? AND r.options_hash=? WHERE a.question_id=? ORDER BY a.position', [j.engine,j.model,j.options_hash,q.id])
        this.db.exec("UPDATE ocr_questions SET ocr_text=?,status='ready',revision=revision+1 WHERE id=?", [parts.map(p => p.markdown).join('\n\n'),q.id]); this.refreshText(q.id)
      }
    })
  }
  fail(id: number, lease: string, message: string, uncertain = false) {
    this.transaction(() => {
      const j = this.active(id,lease); if (!j) return
      this.db.exec('UPDATE ocr_jobs SET state=?,error=?,attempts=attempts+1,lease=? WHERE id=?', [uncertain ? 'uncertain' : 'failed',message,'',id])
      this.db.exec("UPDATE ocr_questions SET status='failed' WHERE id=? AND source_fingerprint=?", [j.question_id,j.fingerprint])
    })
  }
  suspend(id:number,lease:string) {
    this.transaction(()=>{const job=this.active(id,lease);if(!job)return;this.db.exec("UPDATE ocr_jobs SET state='pending',lease='',lease_until=0 WHERE id=?",[id])})
  }
  releaseCaptures(){this.db.exec("UPDATE ocr_jobs SET state='pending',lease='',lease_until=0 WHERE state='rendering' AND asset_id=''")}
  cancel() { this.transaction(() => { this.db.exec("UPDATE ocr_questions SET status='cancelled' WHERE id IN (SELECT question_id FROM ocr_jobs WHERE state IN ('pending','rendering','recognizing','uploading','downloading','normalizing'))"); this.db.exec("UPDATE ocr_jobs SET state=CASE WHEN state='uploading' AND remote_id='' THEN 'uncertain' ELSE 'cancelled' END,lease='' WHERE state IN ('pending','rendering','recognizing','uploading','downloading','normalizing')") }) }
  retry(id: number, confirmed: boolean) {
    this.transaction(() => {
      const j = this.job(id)
      if (!j || !['failed','uncertain','cancelled'].includes(j.state)) throw new Error('该任务无需重试')
      if (j.state === 'uncertain' && !confirmed) throw new Error('远端结果不确定，重新提交可能重复计费，请明确确认')
      if (this.question(j.record_id)?.source_fingerprint !== j.fingerprint || this.question(j.record_id)?.source_generation !== j.generation) throw new Error('原题已变化，请重新同步')
      this.db.exec("UPDATE ocr_jobs SET state='pending',lease='',error='',next_at=? WHERE id=?", [Date.now()+Math.min(30000,1000*Math.pow(2,j.attempts)),id])
      this.db.exec("UPDATE ocr_questions SET status='pending' WHERE id=?", [j.question_id])
    })
  }
  currentJobs(recordId:string){
    const q=this.question(recordId);if(!q)return []
    return this.db.rows('SELECT id,engine,state,error,attempts,remote_id FROM ocr_jobs WHERE question_id=? AND generation=? AND fingerprint=? ORDER BY id DESC',[q.id,q.source_generation,q.source_fingerprint])
  }
  retryFailedBatch(liveIds: Set<string>, confirmation = "") {
    const work = () => {
      const jobs = this.db.rows(`SELECT j.id,j.state,q.id AS question_id,q.record_id FROM ocr_jobs j
        JOIN ocr_questions q ON q.id=j.question_id AND q.source_generation=j.generation AND q.source_fingerprint=j.fingerprint
        WHERE j.state IN ('failed','uncertain') ORDER BY j.id`).filter(job => liveIds.has(job.record_id))
      const signature = jobs.map(job => `${job.id}:${job.state}`).join(',')
      const questions = new Set(jobs.map(job => job.record_id)).size
      const uncertain = jobs.filter(job => job.state === 'uncertain').length
      if (confirmation) {
        if (confirmation !== signature) throw new Error('待重试任务已变化，请重新点击重试失败')
        for (const job of jobs) {
          this.db.exec("UPDATE ocr_jobs SET state='pending',lease='',lease_until=0,error='',next_at=0 WHERE id=?", [job.id])
          this.db.exec("UPDATE ocr_questions SET status='pending' WHERE id=?", [job.question_id])
        }
      }
      return { signature, questions, uncertain, count: jobs.length }
    }
    return confirmation ? this.transaction(work) : work()
  }
  retryQuestion(recordId:string,generation:number,confirmed:boolean,onlyFailed=false){
    return this.transaction(()=>{
      const q=this.question(recordId)
      if(!q||q.source_generation!==generation)throw new Error('题目已更新，请重新打开后重试')
      const jobs=this.currentJobs(recordId).filter(j=>onlyFailed?j.state==='failed':['failed','uncertain','cancelled'].includes(j.state))
      if(jobs.some(j=>j.state==='uncertain')&&!confirmed)throw new Error('提交结果不确定，重新提交可能重复计费，请确认后重试')
      for(const j of jobs)this.db.exec("UPDATE ocr_jobs SET state='pending',lease='',error='',next_at=? WHERE id=?",[Date.now()+Math.min(30000,1000*Math.pow(2,j.attempts)),j.id])
      if(jobs.length){
        const blocked=this.currentJobs(recordId).some(j=>['uncertain','failed'].includes(j.state))
        this.db.exec('UPDATE ocr_questions SET status=? WHERE id=?',[blocked?'failed':'pending',q.id])
      }
      return {accepted:true,count:jobs.length}
    })
  }
  backup() {
    return this.transaction(()=>({format:'cardlink-ocr',schemaVersion:1,createdAt:new Date().toISOString(),tables:Object.fromEntries(backupTables.map(table=>[table,this.db.rows(`SELECT * FROM ${table}`)]))}))
  }
  inspectBackup(value:any) {
    if(value?.format!=='cardlink-ocr'||value.schemaVersion!==1||!value.tables||Object.keys(value.tables).sort().join(',')!==[...backupTables].sort().join(','))throw new Error('不是支持的 CardLink OCR 备份')
    for(const table of backupTables){
      const rows=value.tables[table],columns=this.db.rows(`PRAGMA table_info(${table})`).map(r=>r.name)
      if(!Array.isArray(rows))throw new Error('备份表内容无效')
      for(const row of rows){
        if(!row||Object.keys(row).sort().join(',')!==[...columns].sort().join(',')||Object.values(row).some(v=>v!==null&&typeof v!=='string'&&!(typeof v==='number'&&Number.isFinite(v))))throw new Error('备份字段无效')
        if(table==='ocr_jobs'){
          let config:any;try{config=JSON.parse(row.config_json)}catch{throw new Error('备份任务配置无效')}
          if(!config||!['glm-ocr','mineru'].includes(config.engine)||Object.keys(config).some(k=>!['engine','model','optionsHash','baseUrl','language','formula','table','timeoutMs'].includes(k)))throw new Error('备份任务配置无效')
        }
      }
    }
    return {questions:value.tables.ocr_questions.length,assets:value.tables.ocr_assets.length}
  }
  restoreBackup(value:any) {
    const summary=this.inspectBackup(value)
    return this.transaction(()=>{
      for(const table of [...backupTables].reverse())this.db.exec(`DELETE FROM ${table}`)
      this.db.exec('DELETE FROM ocr_sync_state')
      for(const table of backupTables){
        const columns=this.db.rows(`PRAGMA table_info(${table})`).map(r=>r.name)
        for(const row of value.tables[table]){
          const args:SQLValue[]=[]
          const placeholders=columns.map(key=>{if(row[key]===null)return 'NULL';args.push(row[key]);return '?'})
          this.db.exec(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${placeholders.join(',')})`,args)
        }
      }
      // Import never authorizes paid work or revives another runtime's leases.
      this.db.exec("UPDATE ocr_jobs SET state=CASE WHEN state IN ('uploading','recognizing','downloading','normalizing') AND remote_id='' AND asset_id<>'' THEN 'uncertain' WHEN state IN ('pending','rendering','uploading','recognizing','downloading','normalizing') THEN 'cancelled' ELSE state END,lease='',lease_until=0")
      this.db.exec("UPDATE ocr_questions SET revision=revision+1,status=CASE WHEN EXISTS(SELECT 1 FROM ocr_jobs j WHERE j.question_id=ocr_questions.id AND j.generation=ocr_questions.source_generation AND j.state='uncertain') THEN 'failed' WHEN status IN ('pending','stale') THEN 'cancelled' ELSE status END")
      for(const q of this.db.rows('SELECT id FROM ocr_questions'))this.refreshText(q.id)
      if(this.db.rows('PRAGMA foreign_key_check').length)throw new Error('备份记录关联不完整')
      this.integrity();return {...summary,restored:true}
    })
  }
  orphanSummary(liveIds:string[]) {
    const live=new Set(liveIds),questions=this.db.rows('SELECT record_id FROM ocr_questions').filter(q=>!live.has(q.record_id)).map(q=>q.record_id)
    // Preview with the same transaction as cleanup, then roll back all changes.
    let summary:any
    try{this.transaction(()=>{for(const id of questions)this.db.exec('DELETE FROM ocr_questions WHERE record_id=?',[id]);const assets=this.db.rows('SELECT id,length(data_uri) AS bytes FROM ocr_assets a WHERE NOT EXISTS(SELECT 1 FROM ocr_question_assets qa WHERE qa.asset_id=a.id) AND NOT EXISTS(SELECT 1 FROM ocr_jobs j WHERE j.asset_id=a.id)');summary={questions:questions.length,assets:assets.length,bytes:assets.reduce((n,a)=>n+Number(a.bytes),0)};throw rollbackPreview})}catch(error){if(error!==rollbackPreview)throw error}
    return summary
  }
  cleanOrphans(liveIds:string[]) {
    const summary=this.orphanSummary(liveIds)
    return this.transaction(()=>{
      const live=new Set(liveIds)
      for(const q of this.db.rows('SELECT record_id FROM ocr_questions'))if(!live.has(q.record_id))this.db.exec('DELETE FROM ocr_questions WHERE record_id=?',[q.record_id])
      const assets=this.db.rows('SELECT id FROM ocr_assets a WHERE NOT EXISTS(SELECT 1 FROM ocr_question_assets qa WHERE qa.asset_id=a.id) AND NOT EXISTS(SELECT 1 FROM ocr_jobs j WHERE j.asset_id=a.id)')
      for(const a of assets){this.db.exec('DELETE FROM ocr_results WHERE asset_id=?',[a.id]);this.db.exec('DELETE FROM ocr_assets WHERE id=?',[a.id])}
      return {...summary,cleaned:true}
    })
  }
  integrity() { const rows = this.db.rows('PRAGMA integrity_check'); if (rows.some(r => Object.values(r)[0] !== 'ok')) throw new Error('OCR 数据库完整性检查失败'); this.db.exec("INSERT INTO ocr_question_fts(ocr_question_fts,rank) VALUES('integrity-check',1)"); return { ok:true } }
  rebuild() { this.transaction(() => this.db.exec("INSERT INTO ocr_question_fts(ocr_question_fts) VALUES('rebuild')")); return this.integrity() }
}
