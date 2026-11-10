import { isNSNull, MN } from 'marginnote'
import { ensureStorageDirectory } from './storage-paths'
import { OCRStore, type SQLDriver, type SQLValue } from './ocr-store'

export function ocrRoot() {
  const root = String(MN.app.documentPath || '').replace(/\/+$/, '')
  if (!root) throw new Error('MarginNote 文档目录不可用')
  return `${root}/CardLink/ocr-db/v1`
}
const numeric = new Set(['id','question_id','revision','updated_at','user_version','n','count','total','edited','attempts','next_at','lease_until','consent_at','position','generation','source_generation'])
/** Array binding only: variadic Objective-C calls must never receive user input. */
export function openNativeSQL(path: string): SQLDriver {
  const cls = (globalThis as any).SQLiteDatabase
  if (typeof cls?.databaseWithPath !== 'function') throw new Error('当前宿主未提供 SQLiteDatabase，OCR 数据库暂不可用')
  const db = cls.databaseWithPath(path)
  if (!db || isNSNull(db) || typeof db.executeUpdateWithArgumentsInArray !== 'function' || typeof db.executeQueryWithArgumentsInArray !== 'function') throw new Error('当前 SQLite 桥接缺少数组参数绑定方法，已停止初始化')
  if (!db.open()) throw new Error('OCR 数据库无法打开，请检查存储空间与权限')
  const driver: SQLDriver = {
    exec(sql: string,args: SQLValue[] = []) { if (!db.executeUpdateWithArgumentsInArray(sql,args)) throw new Error('OCR 数据库写入失败（事务已停止），请运行完整性检查') },
    rows(sql: string,args: SQLValue[] = []) {
      const rs = db.executeQueryWithArgumentsInArray(sql,args)
      if (!rs || isNSNull(rs)) throw new Error('OCR 数据库查询失败')
      const rows: any[] = []
      try {
        const count = Number(typeof rs.columnCount === 'function' ? rs.columnCount() : rs.columnCount)
        if (!Number.isInteger(count)) throw new Error('SQLite 结果集列读取不受支持')
        while (rs.next()) {
          const row: any = {}
          for (let i=0;i<count;i++) {
            const key = String(rs.columnNameForIndex(i)), value = rs.stringForColumnIndex(i)
            row[key] = value == null || isNSNull(value) ? null : numeric.has(key) ? Number(value) : String(value)
          }
          rows.push(row)
        }
      } finally { rs.close() }
      return rows
    },
    close() { if (db.close() === false) throw new Error('OCR 数据库关闭失败') }
  }
  // This assignment returns a result row. FMDB rejects SQLITE_ROW in executeUpdate.
  // Use the query path and always close the connection if initialization fails.
  try { driver.rows('PRAGMA busy_timeout=1000') }
  catch (error) { driver.close(); throw error }
  return driver
}
let store: OCRStore | undefined
export function ocrStore(): OCRStore {
  if (!store) {
    if (!ensureStorageDirectory(ocrRoot())) throw new Error('无法创建 OCR 数据库目录')
    const db = openNativeSQL(`${ocrRoot()}/cardlink-ocr.sqlite`)
    try { store = new OCRStore(db) } catch (e) { db.close(); throw e }
  }
  return store
}
export function diagnoseOCR() {
  // Exercise binding and a real rollback inside the plugin-owned database only.
  const s = ocrStore(), marker = "中文 O'Reilly 😀 \\frac{1}{2}"
  s.db.exec('CREATE TEMP TABLE IF NOT EXISTS ocr_probe(value TEXT)')
  s.db.exec('BEGIN IMMEDIATE')
  try {
    s.db.exec('INSERT INTO ocr_probe(value) VALUES(?)',[marker])
    if (s.db.rows('SELECT value FROM ocr_probe')[0]?.value !== marker) throw new Error('Unicode 参数绑定校验失败')
  } finally { s.db.exec('ROLLBACK') }
  if (s.db.rows('SELECT value FROM ocr_probe').length) throw new Error('事务回滚校验失败')
  s.integrity()
  s.db.close(); store = undefined
  ocrStore().integrity()
  return { ok:true, schemaVersion:2, binding:true, rollback:true, reopen:true, appRestart:'需手动验收' }
}
