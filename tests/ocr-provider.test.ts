import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
const calls:any[]=[],stages:any[]=[]
let respond:(method:string,url:string,options:any)=>any=()=>({})
mock.module('marginnote',{namedExports:{delay:async()=>{}}})
mock.module('../src/ocr-transport',{namedExports:{
  ocrHTTP:async(method:string,url:string,options:any)=>{calls.push({method,url,options});return respond(method,url,options)},
  ocrImageData:(s:string)=>s,ocrReadUtf8:()=> 'MinerU 正文'
}})
mock.module('../src/ocr-settings',{namedExports:{
  ocrSecret:()=> 'test-secret',
  loadOCRSettings:()=>({glmOcr:{baseUrl:'https://glm.test',model:'glm-ocr',credentialRef:'glm',timeoutMs:30000},mineru:{baseUrl:'https://mineru.test',credentialRef:'mineru',language:'ch',enableFormula:true,enableTable:true}})
}})
mock.module('../src/storage-paths',{namedExports:{ensureStorageDirectory:()=>true}})
mock.module('../src/ocr-native',{namedExports:{ocrRoot:()=>'/test'}})
;(globalThis as any).ZipArchive={unzipFileAtPathToDestination:()=>true}
;(globalThis as any).NSFileManager={defaultManager:()=>({subpathsOfDirectoryAtPath:()=>['full.md'],removeItemAtPathError:()=>true})}
const hooks={check(){},stage(state:string,remote?:string){stages.push({state,remote})}}
test('MinerU persists remote identity before PUT and resumed tasks never POST again',async()=>{
  const api=await import('../src/ocr-provider');calls.length=0;stages.length=0
  respond=(method,url)=>{
    if(method==='POST')return{json:{code:0,data:{batch_id:'batch-1',file_urls:['https://upload.test/image']}}}
    if(method==='PUT'){assert.deepEqual(stages[stages.length-1],{state:'uploading',remote:'batch-1'});return{}}
    if(url.includes('extract-results'))return{json:{code:0,data:{extract_result:[{data_id:'question',state:'done',full_zip_url:'https://result.test/archive.zip'}]}}}
    return{data:{writeToFileAtomically:()=>true}}
  }
  const first=await api.recognizeAsset(api.providerConfig('mineru'),'data:image/jpeg;base64,aW1n','',hooks)
  assert.equal(first.markdown,'MinerU 正文')
  calls.length=0
  await api.recognizeAsset(api.providerConfig('mineru'),'data:image/jpeg;base64,aW1n','batch-1',hooks)
  assert.ok(calls.every(call=>call.method==='GET'))
  assert.match(calls[0].url,/batch-1$/)
})
test('GLM uncertain POST is not retried; GET recovery retries are bounded',async()=>{
  const api=await import('../src/ocr-provider');calls.length=0
  respond=()=>{throw Error('network timeout')}
  await assert.rejects(api.recognizeAsset(api.providerConfig('glm-ocr'),'data:image/jpeg;base64,aW1n','',hooks),(e:any)=>e.uncertain===true)
  assert.equal(calls.length,1)
  calls.length=0
  await assert.rejects(api.recognizeAsset(api.providerConfig('mineru'),'data:image/jpeg;base64,aW1n','remote',hooks))
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.method==='GET'))
})
test('GLM sends the complete typed image data URI, keeps LaTeX and layout',async()=>{
  const api=await import('../src/ocr-provider');calls.length=0
  respond=()=>({json:{md_results:'求 $\\frac{1}{2}$',layout_details:[{label:'text',content:'题干'}]}})
  const result=await api.recognizeAsset(api.providerConfig('glm-ocr'),'data:image/jpeg;base64,aW1n','',hooks)
  assert.equal(calls[0].options.json.file,'data:image/jpeg;base64,aW1n');assert.equal(result.markdown,'求 $\\frac{1}{2}$');assert.ok(result.blocks.includes('题干'))
})

test('GLM PNG retains its MIME type and malformed inputs are rejected before submission',async()=>{
  const api=await import('../src/ocr-provider');calls.length=0;stages.length=0
  respond=()=>({json:{md_results:'正文'}})
  await api.recognizeAsset(api.providerConfig('glm-ocr'),'data:image/png;base64,aW1n','',hooks)
  assert.equal(calls[0].options.json.file,'data:image/png;base64,aW1n')
  calls.length=0;stages.length=0
  for(const value of ['aW1n','data:image/jpeg;base64,','data:image/gif;base64,aW1n'])await assert.rejects(api.recognizeAsset(api.providerConfig('glm-ocr'),value,'',hooks),(e:any)=>e.kind==='format'&&!e.uncertain)
  assert.equal(calls.length,0);assert.equal(stages.length,0)
})

test('HTTP rejection preserves safe numeric diagnostics without echoing provider payloads or retrying POST',async()=>{
  const api=await import('../src/ocr-provider');calls.length=0
  respond=()=>{throw {params:{status:400,serviceCode:'1210',detail:'token-secret https://private.test/data'}}}
  await assert.rejects(api.recognizeAsset(api.providerConfig('glm-ocr'),'data:image/jpeg;base64,aW1n','',hooks),(e:any)=>e.kind==='request'&&!e.uncertain&&/HTTP 400/.test(e.message)&&/1210/.test(e.message)&&!/token-secret|private/.test(e.message))
  assert.equal(calls.length,1)
  respond=()=>{throw {params:{status:401,detail:'bad input format'}}}
  await assert.rejects(api.recognizeAsset(api.providerConfig('glm-ocr'),'data:image/jpeg;base64,aW1n','',hooks),(e:any)=>e.kind==='credential')
})

test('MinerU pause suspends polling after the current upload and resumes the same remote batch',async()=>{
  const api=await import('../src/ocr-provider');calls.length=0;stages.length=0
  respond=(method,url)=>{
    if(method==='POST')return{json:{code:0,data:{batch_id:'paused-batch',file_urls:['https://upload.test/paused']}}}
    if(method==='PUT')return{}
    if(url.includes('extract-results'))return{json:{code:0,data:{extract_result:[{data_id:'question',state:'done',full_zip_url:'https://result.test/a.zip'}]}}}
    return{data:{writeToFileAtomically:()=>true}}
  }
  await assert.rejects(api.recognizeAsset(api.providerConfig('mineru'),'data:image/jpeg;base64,aW1n','',{...hooks,paused:()=>true}),api.OCRPausedError)
  assert.deepEqual(calls.map(c=>c.method),['POST','PUT'])
  assert.ok(stages.some(s=>s.remote==='paused-batch'))
  calls.length=0
  await api.recognizeAsset(api.providerConfig('mineru'),'data:image/jpeg;base64,aW1n','paused-batch',{...hooks,paused:()=>false})
  assert.ok(calls.every(c=>c.method==='GET'));assert.match(calls[0].url,/paused-batch$/)
})
