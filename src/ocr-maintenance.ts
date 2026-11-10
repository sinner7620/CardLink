import { MN, isNSNull, readJSON, writeTextFile, saveFile } from 'marginnote'
import { ocrRoot, ocrStore } from './ocr-native'
import { ensureStorageDirectory } from './storage-paths'
let candidate:any=null,token=''
function readBackup(path:string){
  const value=readJSON(path)
  // Foundation bridges JSON null as NSNull; manual_text is the nullable backup column.
  const rows=value?.tables?.ocr_questions
  if(Array.isArray(rows))for(const row of rows)if(row&&isNSNull(row.manual_text))row.manual_text=null
  return value
}
export function backupOCR() {
  const s=ocrStore();s.integrity()
  const folder=`${ocrRoot()}/backups`
  if(!ensureStorageDirectory(folder))throw new Error('无法创建备份目录')
  const filename=`CardLink-OCR-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,path=`${folder}/${filename}`
  const value=s.backup();writeTextFile(path,JSON.stringify(value));s.inspectBackup(readBackup(path))
  saveFile(path,'public.json')
  return {created:true,filename,path,savePanelOpened:true}
}
export async function selectOCRBackup() {
  candidate=null;token=''
  // The bundled openFile helper resolves before its asynchronous callback; use the documented host API directly.
  const path=await new Promise<string|undefined>(resolve=>MN.app.openFileWithUTIs(['public.json'],MN.studyController,resolve))
  if(!path)return {cancelled:true}
  const value=readBackup(path),summary=ocrStore().inspectBackup(value)
  candidate=value;token=`${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {...summary,token}
}
export function importOCRBackup(selected:string) {
  if(!candidate||!selected||selected!==token)throw new Error('备份选择已过期，请重新选择')
  const result=ocrStore().restoreBackup(candidate);candidate=null;token='';return result
}
