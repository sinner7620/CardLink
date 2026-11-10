import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

const settingsKey = 'mn4-answer-matcher.ai.settings.v1'
const credentialsKey = 'mn4-answer-matcher.ai.credentials.v1'
const kv: Record<string, unknown> = {
  [settingsKey]: { ocrEngine:'glm-ocr', profiles:[{credentialRef:'old-llm'}], glmOcr:{baseUrl:'https://ocr.test/layout_parsing'} },
  [credentialsKey]: { 'ocr-glm':'local-key-1234', 'old-llm':'old-key-9876' },
}
mock.module('marginnote',{namedExports:{
  getLocalDataByKey:(key:string)=>kv[key],
  setLocalDataByKey:(value:unknown,key:string)=>{kv[key]=value},
}})
mock.module('../src/mistake-store',{namedExports:{loadMistakeState:()=>({records:{}})}})

test('SQLite OCR keeps its configured provider and exposes only OCR credentials', async () => {
  const {ocrSettingsBridge:send,ocrSecret} = await import('../src/ocr-settings')
  const settings = send('ocrGetSettings',{}) as any
  assert.equal(settings.ocrEngine,'glm-ocr')
  assert.equal(settings.glmOcr.baseUrl,'https://ocr.test')
  assert.deepEqual(settings.credentials['ocr-glm'],{configured:true,maskedSuffix:'1234'})
  assert.ok(!JSON.stringify(settings).includes('old-llm'))
  assert.ok(!JSON.stringify(settings).includes('local-key-1234'))
  assert.throws(()=>send('ocrReadCredential',{credentialRef:'old-llm'}),/凭据/)
  assert.throws(()=>send('ocrSetCredential',{credentialRef:'old-llm',value:'other'}),/凭据/)
  assert.deepEqual(send('ocrReadCredential',{credentialRef:'ocr-glm'}),{value:'local-key-1234'})
  send('ocrSetCredential',{credentialRef:'ocr-glm',value:' new-key '})
  assert.equal(ocrSecret('ocr-glm'),'new-key')
  send('ocrClearCredential',{credentialRef:'ocr-glm'})
  assert.equal(ocrSecret('ocr-glm'),'')
  assert.equal((kv[credentialsKey] as any)['old-llm'],'old-key-9876')
})
