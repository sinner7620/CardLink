import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { transpileModule } from "typescript"
import { runInNewContext } from "node:vm"

test("脑图关闭清除复习界面并使迟到恢复失效，重新打开只恢复一次", async () => {
  const source = readFileSync('src/plugin.ts', 'utf8')
  const start = source.indexOf('    notebookWillOpen(notebookId: string)')
  const body = source.slice(start, source.indexOf('    sceneDidDisconnect()', start))
  const calls: string[] = [], pending: Array<() => void> = []
  const scope: any = {
    exports: {}, self: {}, recordRuntimeState() {},
    eventObservers: { remove() {}, add() {} },
    ensureMnutilsEntrance: () => calls.push('entrance'),
    completePendingNoteNavigation: async () => {},
    delay: () => new Promise<void>(resolve => pending.push(resolve)),
    restoreReviewModeToolbar: () => calls.push('restore'),
    suspendReviewModeToolbar: () => calls.push('suspend'),
    closeMnutilsQuickMenu: () => calls.push('menu-close'),
    removeMnutilsEntrance: () => calls.push('entrance-remove'),
    hideAnswerToolbar() {}, closeAnswerCard() {}, closeNotebookPicker() {}, closeMistakeLevelPicker() {},
    closeCardMistakePanel: () => calls.push('feedback-close')
  }
  runInNewContext(transpileModule('exports.lifecycle = {' + body + '}', { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  scope.exports.lifecycle.notebookWillOpen('a')
  scope.exports.lifecycle.notebookWillClose()
  pending.shift()!(); await Promise.resolve()
  assert.equal(calls.includes('restore'), false)
  assert.ok(calls.indexOf('suspend') < calls.indexOf('menu-close'))
  assert.equal(calls.filter(v => v === 'entrance-remove').length, 1)
  assert.equal(calls.filter(v => v === 'feedback-close').length, 1)
  scope.exports.lifecycle.notebookWillOpen('a')
  pending.shift()!(); await Promise.resolve()
  assert.equal(calls.filter(v => v === 'restore').length, 1)
})
