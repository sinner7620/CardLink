import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'
import * as zip from 'fflate'

const config: any = { exports: {}, Uint8Array, TextEncoder, TextDecoder }
runInNewContext(transpileModule(readFileSync('web/src/lib/templateConfiguration.js', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, config)
const scope: any = { exports: {}, require: (id: string) => id === 'fflate' ? zip : config.exports, Uint8Array, btoa }
runInNewContext(transpileModule(readFileSync('web/src/lib/templateConverter.js', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
const api = scope.exports, id = api.CARDLINK_ID
const make = (template: any) => zip.zipSync({
  'template.json': zip.strToU8(JSON.stringify(template)),
  'manifest.json': zip.strToU8(JSON.stringify({ template: { id: 'original', name: '原模板' }, plugins: [{ pluginID: 'other', version: '1' }] })),
  'assets/photo.png': new Uint8Array([1, 2, 3]), 'plugins/other/main.js': zip.strToU8('unchanged')
})
test('模板转换保留名称ID布局素材插件，登记依赖菜单并更新六错因；再次转换不重复', () => {
  const input = make({ id: 'original', name: '原模板', layout: { cards: 3 }, plugins: ['other'],
    selectionMenu: { cards: ['custom'], documents: [] }, pluginConfigs: { other: { v: 7 }, [id]: { tagPrefix: 'own-prefix', custom: true } } })
  const result = api.convertSceneTemplate(input), files = zip.unzipSync(result.bytes)
  const t = JSON.parse(zip.strFromU8(files['template.json'])), m = JSON.parse(zip.strFromU8(files['manifest.json']))
  assert.deepEqual(t.layout, { cards: 3 })
  assert.deepEqual(t.plugins, ['other', id])
  assert.equal(t.id, 'original')
  assert.equal(t.name, '原模板')
  assert.equal(t.pluginConfigs[id].tagPrefix, 'own-prefix')
  assert.equal(t.pluginConfigs[id].custom, true)
  assert.equal(t.pluginConfigs[id].reasons.length, 6)
  assert.deepEqual(t.pluginConfigs.other, { v: 7 })
  assert.equal(t.selectionMenu.cards[0], 'custom')
  assert.equal(t.selectionMenu.cards.length, 3)
  assert.deepEqual(m.plugins, [{ pluginID: 'other', version: '1' }, { pluginID: id, title: 'CardLink', version: '2.4.6-b69' }])
  assert.equal(m.template.id, t.id)
  assert.deepEqual(files['assets/photo.png'], new Uint8Array([1, 2, 3]))
  assert.equal(zip.strFromU8(files['plugins/other/main.js']), 'unchanged')
  const again = zip.unzipSync(api.convertSceneTemplate(result.bytes).bytes)
  assert.equal(zip.strFromU8(again['template.json']), zip.strFromU8(files['template.json']))
  assert.equal(JSON.parse(zip.strFromU8(zip.unzipSync(input)['template.json'])).id, 'original')
  assert.deepEqual(Buffer.from(api.templateBase64(result.bytes), 'base64'), Buffer.from(result.bytes))
  assert.equal(api.convertedTemplateFilename('我的模板.mntemplate'), '我的模板（转换后）.mntemplate')
  assert.equal(api.convertedTemplateFilename('我的模板'), '我的模板（转换后）.mntemplate')
})

test('与用户新上传网页的配置和打包结果一致，原有目录与插件文件均保留', () => {
  const reference: any = { Uint8Array, TextEncoder, TextDecoder }
  runInNewContext(readFileSync('tests/fixtures/template-configuration-reference.js', 'utf8'), reference)
  const input = zip.zipSync({
    'template.json': [zip.strToU8(JSON.stringify({ id: 'same', name: '保持名称', plugins: [], pluginConfigs: { [id]: { tagPrefix: 'keep' } } })), { level: 0 }],
    'manifest.json': zip.strToU8(JSON.stringify({ template: { id: 'same' }, plugins: [{ pluginID: id, folder: id, version: 'old' }] })),
    '素材/': [new Uint8Array(), { level: 0 }],
    '素材/压缩.txt': zip.strToU8('可压缩内容'.repeat(500)),
    '素材/存储.txt': [zip.strToU8('可压缩但要求存储'.repeat(100)), { level: 0 }],
    ['plugins/' + id + '/main.js']: zip.strToU8('unchanged existing plugin')
  })
  const original = zip.unzipSync(input), expected = reference.CardLinkConverter.configure(original, zip)
  const expectedBytes = reference.CardLinkConverter.pack(reference.CardLinkConverter.methods(input), expected.files, zip)
  const actual = zip.unzipSync(api.convertSceneTemplate(input).bytes)
  assert.deepEqual(Object.keys(actual), Object.keys(original))
  assert.deepEqual(actual, zip.unzipSync(expectedBytes))
  const originalMethods = reference.CardLinkConverter.methods(input), newMethods = reference.CardLinkConverter.methods(api.convertSceneTemplate(input).bytes)
  assert.equal(newMethods['template.json'], false)
  assert.equal(newMethods['素材/存储.txt'], false)
  assert.equal(newMethods['素材/压缩.txt'], originalMethods['素材/压缩.txt'])
  assert.equal(zip.strFromU8(actual['plugins/' + id + '/main.js']), 'unchanged existing plugin')
  assert.equal(Object.keys(actual).length, Object.keys(original).length, '不新增任何插件文件')
})
test('无效模板不生成伪配置包', () => {
  assert.throws(() => api.convertSceneTemplate(new Uint8Array([1, 2, 3])))
  assert.throws(() => api.convertSceneTemplate(zip.zipSync({})), /template.json/)
  assert.throws(() => api.convertSceneTemplate(make({ id: 'x', name: 'x', plugins: 'bad' })), /plugins/)
  assert.throws(() => api.convertSceneTemplate(make({ id: 'x', name: 'x', selectionMenu: { cards: 'bad' } })), /菜单/)
})
