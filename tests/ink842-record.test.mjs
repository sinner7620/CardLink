import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restoreInkAnswer, serializeInkAnswer, INK_GENERATOR } from '../web/ink842/record.js'
import { strokeStyle, DEFAULT_INK_SETTINGS } from '../web/ink842/ink-settings.js'
import { goodnotesOptions } from '../web/ink842/goodnotes-adapter.js'
import { renderAnswer } from '../web/ink842/ink-surface.js'
import { validatePluginInkRecord } from '../src/plugin-ink-record.ts'

const png = 'data:image/png;base64,aGVsbG8='
const metadata = () => ({ version: 1, id: '842-test', noteId: 'q', notebookId: 'b', createdAt: 1,
  width: 1000, height: 2000, backgroundHeight: 1500, background: png, image: png })

test('842 格式保存恢复完整笔画、每笔手感与局部擦除后的时间点', () => {
  const answer = { height: 2000, strokes: [[[10,20,.3,0],[30,40,.7,16],[35,50,0,20]]], styles: [strokeStyle(DEFAULT_INK_SETTINGS)] }
  const record = { ...metadata(), strokes: serializeInkAnswer(answer) }
  assert.equal(JSON.parse(record.strokes).generator, INK_GENERATOR)
  assert.equal(validatePluginInkRecord(record, 'q', 'b'), record)
  assert.deepEqual(restoreInkAnswer(record), answer)
  assert.equal(restoreInkAnswer(record).styles[0].feel.stabilization, .9)
})

test('旧版 InkCanvas 记录按1000宽映射坐标并保留原笔型与参数', () => {
  const options = { penType: 'highlighter', size: 8, color: '#facc15', pressureSensitivity: .66, stabilization: 1.2 }
  const record = { ...metadata(), width: 800, height: 1200, strokes: JSON.stringify({ strokes: [
    { options, points: [{x:80,y:160,pressure:.4,time:1000},{x:160,y:240,pressure:.8,time:1016}] }
  ] }) }
  const restored = restoreInkAnswer(record)
  assert.equal(restored.height, 1500)
  assert.deepEqual(restored.strokes[0], [[100,200,.4,0],[200,300,.8,16]])
  assert.equal(restored.styles[0].inputScale, .8)
  assert.equal(restored.styles[0].kind, 'marker')
  assert.deepEqual(goodnotesOptions(restored.styles[0]), options)
  const updated = { ...record, width: 1000, height: restored.height, strokes: serializeInkAnswer(restored) }
  assert.equal(validatePluginInkRecord(updated, 'q', 'b'), updated)
})

test('原生保存拒绝缺失样式、错位纸宽和损坏的842采样', () => {
  const data = { generator: INK_GENERATOR, width: 1000, strokes: [[[1,2,.5,0]]], styles: [strokeStyle(DEFAULT_INK_SETTINGS)] }
  const check = d => validatePluginInkRecord({ ...metadata(), strokes: JSON.stringify(d) }, 'q', 'b')
  assert.throws(() => check({ ...data, styles: [] }), /笔画/)
  assert.throws(() => check({ ...data, width: 800 }), /笔画/)
  assert.throws(() => check({ ...data, strokes: [[[1,2,4,0]]] }), /笔画/)
})

test('延长纸张后导出保留底图高度，不拉伸原题', () => {
  const calls = [], image = {}
  const ctx = { fillRect(...args) { calls.push(['fill', ...args]) }, drawImage(...args) { calls.push(['image', ...args]) } }
  const canvas = { getContext: () => ctx }
  renderAnswer(canvas, { height: 2500, strokes: [], styles: [] }, { background: image, backgroundHeight: 900 })
  assert.deepEqual(calls, [['fill',0,0,1000,2500],['image',image,0,0,1000,900]])
  assert.equal(canvas.height, 2500)
})
