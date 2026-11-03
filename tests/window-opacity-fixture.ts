import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'

/** Model JSB's receiver binding and UIView's frame/bounds relationship. */
export function windowOpacityFixture(View: any, options: { initAlpha?: boolean; failClass?: boolean; failInstance?: boolean } = {}) {
  const scope: any = { exports: {}, self: null, UIView: View, console: { log() {} } }
  scope.JSB = { defineClass(_name: string, methods: any) {
    if (options.failClass) throw new Error('class unavailable')
    return { new() {
      if (options.failInstance) throw new Error('native init failed')
      const view = new View({ x: 0, y: 0, width: 0, height: 0 })
      let frame = view.frame
      Object.defineProperty(view, 'frame', { configurable: true, get: () => frame, set(value) { frame = value; view.bounds = { ...value, x: 0, y: 0 } } })
      Object.defineProperty(view, 'alpha', { configurable: true, get: () => view.layer.opacity, set(value) {
        const previous = scope.self
        scope.self = view
        try { methods.setAlpha(value) } finally { scope.self = previous }
      } })
      if (options.initAlpha) {
        Object.defineProperty(view, 'cardLinkWindowOpacity', { configurable: true, get() { throw new Error('uninitialized native property') } })
        view.alpha = .3
        delete view.cardLinkWindowOpacity
      }
      return view
    } }
  } }
  runInNewContext(transpileModule(readFileSync('src/window-opacity.ts', 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, scope)
  return scope.exports
}
