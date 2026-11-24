export default function captureAnswer(element, options) {
  if (typeof window.html2canvas !== "function") throw new Error("批注截图库加载失败，请重试")
  return window.html2canvas(element, options)
}
