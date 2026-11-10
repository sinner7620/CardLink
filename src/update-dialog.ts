import { MN } from "marginnote"
import { escapeHtml } from "./html-utils"
import { renderOCRMarkdownPreview } from "./markdown"

type UpdateChoice = "later" | "manual" | "direct"
let Delegate: any
const dialogs = new Map<any, { host: UIView; delegate: any; finish: (choice: UpdateChoice) => void }>()

export function renderUpdateDialog(version: string, notes: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;color-scheme:light;--page:#e8eaf0;--surface:#fff;--text:#202126;--muted:#82858d;--line:#e9e9ed;--subtle:#f5f6f8;--blue:#1686f8;--code-bg:#f4f5f7;--shade:rgba(22,25,33,.19)}
@media (prefers-color-scheme: dark){:root{color-scheme:dark;--page:#17191d;--surface:#26282c;--text:#e9eaed;--muted:#a3a4ab;--line:#3b3e43;--subtle:#303338;--blue:#489dfa;--code-bg:#34373b;--shade:rgba(0,0,0,.65)}}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{background:transparent;color:var(--text);font-size:14px;-webkit-font-smoothing:antialiased}
.stage{min-height:100vh;display:grid;place-items:center;padding:22px;background:linear-gradient(145deg,transparent,rgba(120,140,175,.10))}
.backdrop{position:fixed;inset:0;background:rgba(18,22,29,.10);pointer-events:none}
.dialog{position:relative;width:min(100%,448px);height:min(584px,calc(100vh - 40px));background:var(--surface);border:1px solid var(--line);border-radius:15px;box-shadow:0 20px 68px var(--shade),0 2px 8px rgba(30,36,52,.05);display:flex;flex-direction:column;overflow:hidden}
.dialog-header{display:flex;align-items:center;flex:none;padding:19px 21px 17px;border-bottom:1px solid var(--line)}
.heading{font-size:17px;line-height:1.4;font-weight:650;letter-spacing:-.2px}
.md-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:17px 21px 25px;scrollbar-width:thin;scrollbar-color:#c9cbd0 transparent}.md-scroll::-webkit-scrollbar{width:6px}.md-scroll::-webkit-scrollbar-thumb{background:rgba(140,144,155,.35);border-radius:5px}
.prose{font-size:13px;line-height:1.75;overflow-wrap:anywhere}.prose> :first-child{margin-top:0}.prose h1{font-size:19px;letter-spacing:-.3px;line-height:1.45;font-weight:680;margin:0 0 7px}.prose h2{font-size:14px;line-height:1.5;letter-spacing:-.1px;font-weight:680;margin:23px 0 7px}.prose h3{font-size:13px;font-weight:680;margin:17px 0 5px}.prose p{margin:8px 0}.prose ul,.prose ol{padding-left:19px;margin:8px 0}.prose li{padding-left:1px;margin:3px 0}.prose li p{margin:3px 0}.prose strong{font-weight:680}.prose blockquote{margin:11px 0;padding:5px 0 5px 11px;border-left:2px solid var(--line);color:var(--muted)}.prose blockquote p{margin:3px 0}.prose hr{border:0;border-top:1px solid var(--line);margin:22px 0}.prose a{color:var(--blue);text-decoration:none}.prose a:hover{text-decoration:underline}.prose code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;background:var(--code-bg);border-radius:4px;padding:2px 4px}.prose pre{overflow:auto;max-width:100%;padding:10px 12px;border-radius:7px;background:var(--code-bg);font-size:11px}.prose pre code{background:none;padding:0}.prose table{display:block;overflow:auto;max-width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}.prose th,.prose td{white-space:normal;min-width:68px;padding:7px 10px;border:1px solid var(--line);text-align:left;vertical-align:top}.prose th{font-weight:650;background:var(--subtle)}
.dialog-footer{flex:none;border-top:1px solid var(--line);padding:12px 18px;background:var(--surface);display:flex;align-items:center;gap:8px}.btn{height:35px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font-size:13px;font-weight:560;color:var(--text);white-space:nowrap;transition:background .15s,border-color .15s,transform .15s}.btn:hover{background:var(--subtle)}.btn:active{transform:scale(.98)}.btn:focus-visible{outline:3px solid rgba(22,134,248,.3);outline-offset:2px}.btn-later{padding:0 9px;border-color:transparent;color:var(--muted);font-weight:500}.push{flex:1}.btn-primary{border-color:var(--blue);background:var(--blue);color:white;padding:0 17px}.btn-primary:hover{background:#0874ec;border-color:#0874ec}
@media(max-width:480px){.stage{padding:12px}.dialog{width:100%;height:min(584px,calc(100vh - 24px));border-radius:13px}.dialog-header{padding:15px 17px 13px}.md-scroll{padding:15px 17px 20px}.dialog-footer{padding:11px 14px}.btn{height:36px;font-size:12px}.btn-primary{padding-inline:12px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important}}
.btn{display:inline-flex;align-items:center;text-decoration:none}.stage{position:fixed;inset:0;background:rgba(18,22,29,.10);padding:12px}.dialog{width:100%;max-width:448px;height:calc(100vh - 24px);max-height:584px}.prose img{max-width:100%}
</style></head><body><main class="stage">
<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
  <header class="dialog-header"><div class="heading" id="dialog-title">CardLink ${escapeHtml(version)}</div></header>
  <div class="md-scroll" aria-label="Markdown 更新说明" tabindex="0"><article class="prose">${renderOCRMarkdownPreview(notes)}</article></div>
  <footer class="dialog-footer">
    <a class="btn btn-later" href="cardlink-update://later">稍后</a><div class="push"></div>
    <a class="btn" href="cardlink-update://manual">手动安装</a>
    <a class="btn btn-primary" href="cardlink-update://direct">直接安装</a>
  </footer>
</section></main></body></html>`
}

export function closeUpdateDialog(host: UIView | undefined): void {
  if (!host) return
  for (const dialog of dialogs.values()) {
    if (dialog.host === host) dialog.finish("later")
  }
}

export function showUpdateDialog(version: string, notes: string): Promise<UpdateChoice> | undefined {
  if (typeof UIWebView === "undefined" || typeof JSB === "undefined") return
  const host = MN.studyController?.view
  if (!host) return

  if (!Delegate) Delegate = JSB.defineClass("CardLinkUpdateDialogDelegate : UIViewController <UIWebViewDelegate>", {
    webViewShouldStartLoadWithRequestNavigationType(view: any, request: any) {
      const url = String(request.URL().absoluteString())
      if (url === "about:blank") return true
      const action = /^cardlink-update:\/\/(later|manual|direct)\/?$/.exec(url)
      if (action) dialogs.get(view)?.finish(action[1] as UpdateChoice)
      return false
    }
  }, {})

  const view = new UIWebView(host.bounds)
  const delegate = Delegate.new()
  view.delegate = delegate
  view.backgroundColor = UIColor.clearColor()
  view.opaque = false
  view.autoresizingMask = (1 << 1) | (1 << 4)
  ;(view.layer as any).zPosition = 120000
  return new Promise(resolve => {
    dialogs.set(view, { host, delegate, finish(choice) {
      dialogs.delete(view)
      view.delegate = null
      view.removeFromSuperview()
      resolve(choice)
    } })
    try {
      host.addSubview(view)
      view.loadHTMLStringBaseURL(renderUpdateDialog(version, notes), null)
    } catch (error) {
      dialogs.delete(view)
      view.delegate = null
      view.removeFromSuperview()
      throw error
    }
  })
}
