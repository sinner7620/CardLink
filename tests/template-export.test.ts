import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'
import { decodeBase64Ascii } from '../src/base64'
import * as zip from 'fflate'

test('模板导出原样保存 ZIP 数据，文件名限制在临时目录，写入失败不调保存面板', () => {
  const calls: any[] = []; let writable = true
  const scope: any = { exports: {}, NSData: { dataWithStringEncoding: (data: string, encoding: number) => {
    assert.equal(encoding, 5)
    return { writeToFileAtomically: (path: string) => { calls.push({ data: Buffer.from(data, 'latin1'), path }); return writable } }
  } },
    require: (id: string) => id === 'marginnote' ? { saveFile: (path: string, uti: string) => calls.push({ save: path, uti }) }
      : id === './base64' ? { decodeBase64Ascii } : { cardLinkTempPath: () => '/private/CardLink/templates', ensureStorageDirectory: () => true } }
  runInNewContext(transpileModule(readFileSync('src/template-export.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  const bytes = 'UEsDBAoAAAA=', result = scope.exports.exportSceneTemplate({ filename: '../我的模板.mntemplate', base64: bytes })
  assert.equal(result.saved, true)
  assert.deepEqual(calls[0].data, Buffer.from(bytes, 'base64'))
  assert.equal(calls[0].path, '/private/CardLink/templates/.._我的模板.mntemplate')
  assert.equal(calls[1].save, calls[0].path)
  assert.equal(calls[1].uti, 'public.zip-archive')
  assert.throws(() => scope.exports.exportSceneTemplate({ filename: 'x', base64: 'garbage' }), /数据无效/)
  writable = false
  assert.throws(() => scope.exports.exportSceneTemplate({ filename: 'x', base64: bytes }), /写入失败/)
  assert.equal(calls.filter(c => c.save).length, 1)
  writable = true
  const original = zip.zipSync({ 'template.json': zip.strToU8('{"name":"中文模板"}'), 'binary.bin': Uint8Array.from({ length: 256 }, (_, i) => i) })
  scope.exports.exportSceneTemplate({ filename: '完整模板.mntemplate', base64: Buffer.from(original).toString('base64') })
  const writes = calls.filter(c => c.data), written = writes[writes.length - 1].data
  assert.deepEqual(written, Buffer.from(original), '包含全部 0–255 字节的 ZIP 原样写入')
  assert.deepEqual(zip.unzipSync(written), zip.unzipSync(original))
})

test('在线转换通过原生打开完整指定链接，保留 sharecode', () => {
  const urls: string[] = []
  const link: any = { exports: {} }
  runInNewContext(transpileModule(readFileSync('src/template-converter-link.ts', 'utf8'), { compilerOptions: { module: 1 } }).outputText, link)
  const scope: any = { exports: {}, require: (id: string) => id === 'marginnote' ? { MN: { app: { openURL: (url: string) => urls.push(url) } }, genNSURL: (url: string) => url }
    : id.includes('template-converter-link') ? link.exports : {} }
  runInNewContext(transpileModule(readFileSync('src/template-export.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  assert.equal(scope.exports.openTemplateConverter().opened, true)
  assert.deepEqual(urls, ['https://aa284ce6291caf829.app.workbuddy.host/?sharecode=NW437CTJV6'])
})
