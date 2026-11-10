import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const root=mkdtempSync(join(tmpdir(),'ocr-jsb-contract-'))
let resultSets=0,closedResults=0,closedConnections=0
mock.module('marginnote',{namedExports:{MN:{app:{documentPath:root}},isNSNull:(v:any)=>v===null}})
mock.module('../src/storage-paths',{namedExports:{ensureStorageDirectory:(path:string)=>{mkdirSync(path,{recursive:true});return true}}})
;(globalThis as any).SQLiteDatabase={databaseWithPath:(path:string)=>{
  let raw:DatabaseSync
  return{
    open(){raw=new DatabaseSync(path);return true},close(){closedConnections++;raw.close();return true},
    executeUpdateWithArgumentsInArray(sql:string,args:any[]){try{const stmt=raw.prepare(sql);if(stmt.columns().length)return false;stmt.run(...args);return true}catch{return false}},
    executeQueryWithArgumentsInArray(sql:string,args:any[]){
      try{
        const stmt=raw.prepare(sql),rows=stmt.all(...args),columns=stmt.columns().map(c=>c.name);let position=-1;resultSets++
        return{columnCount:()=>columns.length,columnNameForIndex:(i:number)=>columns[i],stringForColumnIndex:(i:number)=>rows[position][columns[i]]===null?null:String(rows[position][columns[i]]),next:()=>++position<rows.length,close:()=>{closedResults++}}
      }catch{return null}
    }
  }
}}
test('native adapter contract closes every result set, binds Unicode, rolls back and reopens',async()=>{
  const api=await import('../src/ocr-native')
  try{
    const diagnostic=api.diagnoseOCR()
    assert.equal(diagnostic.rollback,true);assert.equal(diagnostic.reopen,true)
    const s=api.ocrStore()
    assert.equal(Number(s.db.rows('PRAGMA busy_timeout')[0].timeout),1000)
    assert.throws(()=>s.transaction(()=>{s.db.exec('INSERT INTO missing VALUES(?)',["中文 O'Reilly"])}),/写入失败/)
    assert.equal(s.integrity().ok,true)
    assert.equal(resultSets,closedResults);assert.ok(closedConnections>=1)
    s.db.close()
  }finally{rmSync(root,{recursive:true})}
})

test('failed busy-timeout initialization closes the opened connection',async()=>{
  const api=await import('../src/ocr-native'),runtime=globalThis as any,original=runtime.SQLiteDatabase
  let closed=false
  runtime.SQLiteDatabase={databaseWithPath:()=>({open:()=>true,close:()=>{closed=true;return true},executeUpdateWithArgumentsInArray:()=>true,executeQueryWithArgumentsInArray:()=>null})}
  try{assert.throws(()=>api.openNativeSQL('/unused'),/查询失败/);assert.equal(closed,true)}
  finally{runtime.SQLiteDatabase=original}
})
