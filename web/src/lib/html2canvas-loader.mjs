// Capture the bundle URL while app.js executes; previews live outside web-dist.
const bundleUrl = typeof document === "undefined" ? undefined : document.currentScript?.src

export function createHtml2CanvasLoader(targetWindow, baseUrl) {
  let pending
  return function ensureHtml2Canvas() {
    if (typeof targetWindow.html2canvas === "function") return Promise.resolve(targetWindow.html2canvas)
    if (pending) return pending
    const script = targetWindow.document.createElement("script")
    script.src = new URL("./vendor/html2canvas.min.js", baseUrl).href
    pending = new Promise((resolve, reject) => {
      script.onload = () => {
        if (typeof targetWindow.html2canvas === "function") resolve(targetWindow.html2canvas)
        else reject(new Error("题目截图库加载失败，请重试。"))
      }
      script.onerror = () => reject(new Error("题目截图库加载失败，请重试。"))
      targetWindow.document.head.appendChild(script)
    }).catch(error => {
      pending = undefined
      script.remove()
      throw error
    })
    return pending
  }
}

let loader
export function ensureHtml2Canvas() {
  loader ||= createHtml2CanvasLoader(window, bundleUrl || document.baseURI)
  return loader()
}
