import { delay } from 'marginnote'
import { ocrHTTP, ocrImageData, ocrReadUtf8 } from './ocr-transport'
import { ocrSecret, loadOCRSettings } from './ocr-settings'
import { ensureStorageDirectory } from './storage-paths'
import { ocrRoot } from './ocr-native'
import { sha256Hex } from './content-fingerprint'
import { mineruDoneResults, mineruFailureMessage, mineruServiceError } from './mineru-response'
import type { OCRConfig } from './ocr-store'

export function providerConfig(engine: 'glm-ocr' | 'mineru', force = ''): OCRConfig {
  const s = loadOCRSettings()
  const config = engine === 'glm-ocr'
    ? {engine,model:'glm-ocr',baseUrl:s.glmOcr.baseUrl,timeoutMs:s.glmOcr.timeoutMs}
    : {engine,model:'vlm',baseUrl:s.mineru.baseUrl,language:s.mineru.language,formula:s.mineru.enableFormula,table:s.mineru.enableTable}
  if (!/^https:\/\/[^/?#@]+(?:\/[^?#]*)?$/.test(config.baseUrl)) throw new Error('OCR 服务地址须为 HTTPS 基础地址，不得包含凭据或查询参数')
  return {...config,optionsHash:sha256Hex(JSON.stringify([config,force]))}
}
export function checkCredential(engine: string) {
  const s = loadOCRSettings(), token = ocrSecret(engine === 'mineru' ? s.mineru.credentialRef : s.glmOcr.credentialRef)
  if (!token) throw new Error(`请先设置 ${engine === 'mineru' ? 'MinerU Token' : 'GLM-OCR API Key'}`)
  return token
}
export interface ProviderHooks { check(): void; stage(state: string, remoteId?: string): void; paused?(): boolean; response?(method:string,status:number,serviceCode:string):void }
export class OCRPausedError extends Error {}
export class OCRProviderError extends Error {
  constructor(readonly kind: string, readonly uncertain = false, status = 0, serviceCode = '') {
    const label=({credential:'凭据无效或未配置',rate:'服务限流，请稍后重试',format:'图片输入格式无效',request:'服务拒绝请求参数',timeout:'服务请求超时',network:'网络请求失败',unknown:'提交结果不确定'} as any)[kind] || 'OCR 服务处理失败'
    const safeStatus=Number.isInteger(status)&&status>=100&&status<=599?status:0
    const safeCode=/^\d{1,8}$/.test(serviceCode)?serviceCode:''
    const details=[safeStatus?`HTTP ${safeStatus}`:'',safeCode?`服务码 ${safeCode}`:''].filter(Boolean)
    super(label+(details.length?`（${details.join(' · ')}）`:''))
  }
}
/** Never reads/writes legacy OCR JSON. Remote IDs are persisted before upload. */
export async function recognizeAsset(config: OCRConfig, dataUri: string, remoteId: string, hooks: ProviderHooks) {
  const token = checkCredential(config.engine), headers = {Authorization:`Bearer ${token}`}
  const call = async (method: string,url: string,options: any = {}) => {
    for (let attempt=0;;attempt++) {
      hooks.check()
      if(method==='GET'&&hooks.paused?.())throw new OCRPausedError('队列已暂停')
      try { const result = await ocrHTTP(method,url,options); hooks.response?.(method,Number(result.status)||0,'');hooks.check(); return result }
      catch (error:any) {
        hooks.check()
        const text = String(error?.params?.detail || error?.message || '')
        const status=Number(error?.params?.status)||0
        const rawCode=String(error?.params?.serviceCode||''),serviceCode=/^\d{1,8}$/.test(rawCode)?rawCode:''
        hooks.response?.(method,status,serviceCode)
        const kind = status ? [401,403].includes(status)?'credential':status===429?'rate':[400,422].includes(status)?'request':[413,415].includes(status)?'format':'network' : /401|403|凭据|unauthorized|api.?key/i.test(text) ? 'credential' : /429|限流|rate.limit/i.test(text) ? 'rate' : /400|422/i.test(text)?'request':/格式/i.test(text)?'format':error?.code==='timeout'||/timeout|timed out|超时/i.test(text)?'timeout':'network'
        if (method === 'GET' && attempt<2 && ['rate','network','timeout'].includes(kind)) { await delay(Math.pow(2,attempt+1)); continue }
        throw new OCRProviderError(kind,method==='POST' && ['network','timeout'].includes(kind),status,serviceCode)
      }
    }
  }
  if (config.engine === 'glm-ocr') {
    if (!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUri)) throw new OCRProviderError('format')
    hooks.stage('uploading')
    const result = await call('POST',`${config.baseUrl}/layout_parsing`,{headers,json:{model:'glm-ocr',file:dataUri,return_crop_images:false,need_layout_visualization:false},timeoutMs:config.timeoutMs})
    const markdown = String(result.json?.md_results || '').trim()
    if (!markdown) throw new Error('OCR 返回空正文，请检查图片')
    hooks.stage('normalizing')
    return {markdown,blocks:JSON.stringify(result.json?.layout_details || [])}
  }
  let batch = remoteId
  if (!batch) {
    hooks.stage('uploading')
    const created = await call('POST',`${config.baseUrl}/api/v4/file-urls/batch`,{headers,json:{files:[{name:'question.jpg',data_id:'question'}],model_version:'vlm',language:config.language,enable_formula:config.formula,enable_table:config.table}})
    const error = mineruServiceError(created.json,'申请上传'); if (error) throw new Error(error)
    batch = String(created.json?.data?.batch_id || '')
    const url = created.json?.data?.file_urls?.[0]
    if (!batch || !url) throw new Error('MinerU 未返回上传地址或任务 ID')
    hooks.stage('uploading',batch)
    await call('PUT',String(url),{headers:{'Content-Type':''},data:ocrImageData(dataUri),timeoutMs:120000})
  }
  // On resume query the saved batch first; never submit a new paid batch here.
  for (let attempt=0;attempt<120;attempt++) {
    hooks.stage('recognizing',batch)
    const status = await call('GET',`${config.baseUrl}/api/v4/extract-results/batch/${encodeURIComponent(batch)}`,{headers,timeoutMs:30000})
    const error = mineruServiceError(status.json,'查询任务') || mineruFailureMessage(status.json)
    if (error) throw new Error(error)
    const done = mineruDoneResults(status.json)
    if (done.length) {
      if (done.length !== 1 || (done[0].dataId && done[0].dataId !== 'question')) throw new Error('MinerU 返回题目身份不匹配')
      hooks.stage('downloading',batch)
      const archive = await call('GET',done[0].zipUrl,{timeoutMs:120000})
      const root = `${ocrRoot()}/temp/${sha256Hex(batch)}`, zip = `${root}.zip`
      ensureStorageDirectory(root)
      try {
        if (!archive.data?.writeToFileAtomically(zip,true) || !ZipArchive.unzipFileAtPathToDestination(zip,root)) throw new Error('MinerU 结果下载或解压失败')
        const files = Array.from(NSFileManager.defaultManager().subpathsOfDirectoryAtPath(root) || []) as string[]
        const file = files.find(name => /(?:^|\/)full\.md$/i.test(name))
        const markdown = file ? ocrReadUtf8(`${root}/${file}`).trim() : ''
        if (!markdown) throw new Error('MinerU 未返回有效正文')
        hooks.stage('normalizing',batch); return {markdown,blocks:''}
      } finally {
        const manager:any = NSFileManager.defaultManager()
        manager.removeItemAtPathError(zip,null); manager.removeItemAtPathError(root,null)
      }
    }
    await delay(Math.min(10,2+attempt/10))
  }
  throw new Error('MinerU 任务尚未完成，可稍后恢复查询')
}
