/** Only CardLink-owned window shells intercept host dimming. Child controls keep
 * their own disabled/transition alpha, and no UIKit class is patched globally. */
let WindowView: any
let classUnavailable = false

function read(view: any, key: string): any {
  try { return view?.[key] } catch { return undefined }
}

/** Native frame changes during tracking must not inherit a surrounding tween. */
export function setWindowFrame(view: any, frame: any): void {
  const native = UIView as any
  const canDisable = typeof native.areAnimationsEnabled === 'function' && typeof native.setAnimationsEnabled === 'function'
  const enabled = canDisable ? native.areAnimationsEnabled() : undefined
  try {
    if (canDisable) native.setAnimationsEnabled(false)
    view.frame = frame
    const layer = view.layer
    if (typeof layer?.removeAnimationForKey === 'function') {
      layer.removeAnimationForKey('position')
      layer.removeAnimationForKey('bounds')
    }
  } finally {
    if (canDisable) native.setAnimationsEnabled(enabled)
  }
}

export function createWindowSurface(frame: any): UIView {
  if (!WindowView && !classUnavailable) {
    try { WindowView = JSB.defineClass("CardLinkWindowSurface : UIView", {
      setAlpha(_requested: number) {
        const view = self as any
        // UIKit can call this during init, before our custom field exists.
        const layer = read(view, 'layer')
        if (!layer) return
        const stored = Number(read(view, 'cardLinkWindowOpacity'))
        const opacity = Number.isFinite(stored) ? stored : 1
        if (Number(layer.opacity) !== opacity) {
          layer.opacity = opacity
          if (typeof layer.removeAnimationForKey === 'function') layer.removeAnimationForKey('opacity')
        }
      }
    }, {}) } catch (error) {
      classUnavailable = true
      console.log('CardLink window opacity subclass unavailable: ' + String(error))
    }
  }
  let view: any
  try { view = WindowView?.new() } catch (error) {
    console.log('CardLink window opacity instance unavailable: ' + String(error))
  }
  // Appearance support must not prevent opening a practice/menu window.
  if (!view) return new UIView(frame)
  try { view.cardLinkWindowOpacity = 1 } catch { /* Setter defaults to 1 during native initialization. */ }
  view.frame = frame
  view.layer.opacity = 1
  return view
}

/** Explicit plugin transitions use this instead of a host alpha request. */
export function setWindowSurfaceOpacity(view: any, opacity: number): void {
  if (!view) return
  const value = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1))
  if (read(view, 'cardLinkWindowOpacity') !== undefined) {
    view.cardLinkWindowOpacity = value
    view.layer.opacity = value
  } else view.alpha = value
}
