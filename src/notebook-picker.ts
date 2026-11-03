import { MN, delay } from 'marginnote'
import { escapeHtml } from './html-utils'
import { createWindowSurface } from './window-opacity'

export interface NotebookPickerItem { id: string; title: string }
let Delegate: any
let pending: { shield: any; container: any; view: any; delegate: any; items: NotebookPickerItem[]; resolve: (item?: NotebookPickerItem) => void } | undefined

export function notebookPickerFrame(bounds: { width: number; height: number }, count: number) {
  const width = Math.max(1, Math.min(480, bounds.width - 32))
  const height = Math.max(1, Math.min(560, bounds.height - 32, 168 + Math.min(count, 8) * 48))
  return { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height }
}

export function notebookPickerHtml(items: NotebookPickerItem[], title: string, message: string): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}[hidden]{display:none!important}:root{color-scheme:light dark;--ink:#172033;--muted:#647084;--surface:rgba(247,248,250,.88);--field:rgba(255,255,255,.46);--line:rgba(148,163,184,.35);--hover:rgba(14,141,253,.12);--accent:#0e8dfd}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body{font:15px system-ui;color:var(--ink)}
main{width:100%;height:100%;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;min-width:0}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:18px;margin:0;overflow-wrap:anywhere}p{font-size:13px;color:var(--muted);margin:10px 0}input{font:inherit;color:var(--ink);background:var(--field);padding:10px;border:1px solid var(--line);border-radius:8px;width:100%}#list{overflow:auto;flex:1;min-height:0;overscroll-behavior:contain;margin-top:10px}button{font:inherit;cursor:pointer;color:inherit}#list button{display:block;width:100%;text-align:left;white-space:normal;overflow-wrap:anywhere;border:0;border-bottom:1px solid var(--line);background:transparent;padding:13px 8px}#list button:focus-visible,#list button:hover{background:var(--hover);border-radius:8px}header button{background:none;border:0;color:var(--accent);padding:8px;flex-shrink:0}#empty{display:none}@media(prefers-color-scheme:dark){:root{--ink:#eef2f7;--muted:#a9b4c5;--surface:rgba(30,36,47,.94);--field:rgba(255,255,255,.06);--line:rgba(148,163,184,.25);--accent:#64b5ff}}</style>
<body onclick="if(event.target===this)location.href='cardlink-picker://cancel'"><main role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><h1>${escapeHtml(title)}</h1><button onclick="location.href='cardlink-picker://cancel'">取消</button></header><p>${escapeHtml(message)}</p><input aria-label="搜索学习集或脑图" placeholder="搜索名称" oninput="filter(this.value)"><div id="list">${items.map((item, index) => `<button data-title="${escapeHtml(item.title.toLowerCase())}" onclick="location.href='cardlink-picker://pick/${index}'">${index + 1}. ${escapeHtml(item.title)}</button>`).join('')}<p id="empty">没有匹配的结果</p></div></main><script>function filter(value){let count=0;document.querySelectorAll('#list button').forEach(function(button){button.hidden=!button.dataset.title.includes(value.toLowerCase());if(!button.hidden)count++});document.getElementById('empty').style.display=count?'none':'block'}</script></body></html>`
}

export async function chooseNotebook(items: NotebookPickerItem[], title = '绑定答案脑图', message = '请选择对应的答案脑图'): Promise<NotebookPickerItem | undefined> {
  closeNotebookPicker()
  await delay(0.08)
  const study = MN.studyController.view
  const host = (study as any).window || study, bounds = host.bounds
  // Visual zPosition does not move a study descendant above window siblings for hit testing.
  const shield = createWindowSurface({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  shield.autoresizingMask = (1 << 1) | (1 << 4)
  shield.backgroundColor = UIColor.clearColor()
  ;(shield as any).userInteractionEnabled = true
  ;(shield as any).opaque = false
  ;(shield.layer as any).zPosition = 110001
  const frame = notebookPickerFrame(bounds, items.length)
  const container = createWindowSurface(frame)
  container.autoresizingMask = 1 | (1 << 2) | (1 << 3) | (1 << 5)
  container.backgroundColor = UIColor.clearColor()
  ;(container.layer as any).zPosition = 110001
  const view = new UIWebView({ x: 0, y: 0, width: frame.width, height: frame.height })
  view.autoresizingMask = (1 << 1) | (1 << 4)
  const native = view as any
  native.opaque = false
  native.backgroundColor = UIColor.clearColor()
  native.scrollView.opaque = false
  native.scrollView.backgroundColor = UIColor.clearColor()
  native.scrollView.scrollEnabled = false
  native.scrollView.bounces = false
  native.layer.cornerRadius = 16
  native.layer.masksToBounds = true
  if (!Delegate) Delegate = JSB.defineClass('CardLinkNotebookPickerDelegate : UIViewController <UIWebViewDelegate>', {
    webViewShouldStartLoadWithRequestNavigationType(web: any, request: any) {
      const url = String(request.URL().absoluteString())
      if (!url.startsWith('cardlink-picker://')) return url === 'about:blank'
      if (!pending || pending.view !== web) return false
      const match = /^cardlink-picker:\/\/pick\/(\d+)$/.exec(url)
      const session = pending
      if (match) {
        const item = session.items[Number(match[1])]
        if (!item) return false
        pending = undefined; session.shield.removeFromSuperview(); session.resolve(item)
      } else if (url === 'cardlink-picker://cancel') closeNotebookPicker()
      return false
    }
  }, {})
  return new Promise(resolve => {
    const delegate = Delegate.new()
    pending = { shield, container, view, delegate, items, resolve }
    view.delegate = delegate
    container.addSubview(view); shield.addSubview(container); host.addSubview(shield)
    host.bringSubviewToFront(shield)
    view.loadHTMLStringBaseURL(notebookPickerHtml(items, title, message), NSURL.URLWithString('about:blank'))
  })
}

export function closeNotebookPicker(): void {
  const session = pending; pending = undefined
  if (session) { session.shield.removeFromSuperview(); session.resolve(undefined) }
}
export function onNotebookPickerAction(): void {}
