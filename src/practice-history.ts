import { createWindowSurface, setWindowFrame } from "./window-opacity"
import { MN, showHUD } from 'marginnote'
import { renderCardHtml, escapeHtml } from './card-html'
import { attemptAnswerChecked, practiceHistoryRows } from './practice-attempts'
import { UI_COLORS } from './ui-tokens'
import { pluginInkFrame } from './plugin-ink-layout'

let Delegate: any
const sessions = new Map<any, { owner: any; container: any; view: any; rows: any[]; noteid: string; delegate: any; initialized?: boolean; selected?: number; continuing?: boolean; resume?: (id: string, nativePaper?: boolean) => Promise<void> }>()
export function closePracticeHistory(owner: any): void {
  for (const [view, session] of sessions) if (session.owner === owner) { session.container.removeFromSuperview(); sessions.delete(view) }
}

function detail(session: any, index: number): void {
  const row = session.rows[index]
  if (!row) return
  session.selected = index
  const note = MN.db.getNoteById(session.noteid)
  const comments: any[] = Array.from(note?.comments || [])
  const found = comments.find(c => row.commentId && c.commentId === row.commentId)
  const indexed = comments[row.index - 1]
  // Classic JSB may omit commentId. Use the documented one-based index only
  // when that entry has no conflicting identity and its text still matches.
  const comment = found || (indexed && !indexed.commentId && String(indexed.text || '') === String(row.text || '') ? indexed : undefined)
  const media = (hash: string) => { try { return String(MN.db.getMediaByHash(hash)?.base64Encoding() || '') || undefined } catch { return undefined } }
  let html = comment ? renderCardHtml({ noteTitle: `第 ${row.ordinal} 次作答`, comments: [comment] }, '历史作答', id => MN.db.getNoteById(id), media, media, false, false)
    : '<p style="padding:24px">无法读取这次作答的图片，请在原卡片查看。</p>'
  html = html.replace('</body>', `<script>let x,y;document.addEventListener('touchstart',e=>{x=e.touches[0].clientX;y=e.touches[0].clientY},{passive:true});document.addEventListener('touchend',e=>{const t=e.changedTouches[0],dx=t.clientX-x;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(t.clientY-y)*1.5)parent.postMessage({type:'history-list-swipe',folded:dx<0},'*')},{passive:true});</script></body>`)
  session.view.evaluateJavaScript(`window.showAttempt(${index},${JSON.stringify(html).replace(/</g, '\\u003c')})`, null)
}

export async function openPracticeHistory(owner: any, noteid: string, topicid: string, resume?: (id: string, nativePaper?: boolean) => Promise<void>): Promise<void> {
  const state = owner.cardLinkReviewMode
  const result = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, { operation: 'practice-history', noteid })
  if (owner.cardLinkReviewMode !== state || state?.items?.[state.index]?.sourceNoteId !== noteid) return
  closePracticeHistory(owner)
  owner.cardLinkHistoryClose = () => closePracticeHistory(owner)
  const rows = practiceHistoryRows(result.comments || [], topicid, noteid).map(row => {
    const original = (result.comments || []).find((c: any) => c.commentId === row.commentId)
    return { ...row, nativePaper: original?.practice?.addon === 'marginnote.extension.mn4-answer-matcher' &&
      String(original?.practice?.topic).toLowerCase() === topicid.toLowerCase() &&
      (!original?.practice?.card || String(original.practice.card).toLowerCase() === noteid.toLowerCase()) }
  })
  const host = MN.studyController.view, bounds = host.bounds
  const frame = pluginInkFrame(bounds, { width: 680, height: 500, y: (bounds.height - 500) / 2 })
  const { width, height } = frame
  const container = createWindowSurface(frame)
  container.backgroundColor = UIColor.whiteColor(); container.layer.cornerRadius = 16; container.layer.masksToBounds = true
  ;(container.layer as any).zPosition = 110000
  const view = new UIWebView({ x: 0, y: 0, width, height })
  view.autoresizingMask = (1 << 1) | (1 << 4)
  if (!Delegate) Delegate = JSB.defineClass('CardLinkHistoryDelegate : UIViewController <UIWebViewDelegate>', {
    webViewShouldStartLoadWithRequestNavigationType(web: any, request: any) {
      const url = String(request.URL().absoluteString()), session = sessions.get(web)
      if (!url.startsWith('cardlink-history://')) return url === 'about:blank' || url.startsWith('about:srcdoc') || url.startsWith('data:')
      if (!session) return false
      if (url.includes('://close')) closePracticeHistory(session.owner)
      else if (url.includes('://layout/')) {
        try {
          const requested = JSON.parse(decodeURIComponent(url.split('://layout/')[1]))
          const bounds = MN.studyController.view.bounds
          const frame = pluginInkFrame(bounds, requested)
          setWindowFrame(session.container, frame)
          session.view.evaluateJavaScript(`window.historyFrame=${JSON.stringify(frame)}`, null)
        } catch { /* Ignore invalid geometry without disturbing the current answer. */ }
      }
      else if (url.includes('://continue')) {
        const row = session.rows[session.selected ?? -1]
        if (!row?.commentId || !session.resume || session.continuing) return false
        session.continuing = true
        void session.resume(row.commentId, row.nativePaper).then(() => closePracticeHistory(session.owner))
          .catch(error => showHUD(`继续作答失败：${String(error?.message || error)}`, 4))
          .finally(() => { session.continuing = false })
      }
      else if (url.includes('://select/')) detail(session, Number(url.split('://select/')[1].split(/[?#]/)[0]))
      return false
    },
    historyPan(sender: any) {
      const session = Array.from(sessions.values()).find(s => s.container === sender.view?.superview)
      if (!session) return
      const host = MN.studyController.view
      const delta = sender.translationInView(host)
      sender.setTranslationInView({ x: 0, y: 0 }, host)
      const frame = pluginInkFrame(host.bounds, { ...session.container.frame, x: session.container.frame.x + delta.x, y: session.container.frame.y + delta.y })
      setWindowFrame(session.container, frame)
      if (sender.state === 3 || sender.state === 4 || sender.state === 5) session.view.evaluateJavaScript(`window.historyFrame=${JSON.stringify(frame)}`, null)
    },
    webViewDidFinishLoad(web: any) { const session = sessions.get(web); if (session?.rows.length && !session.initialized) { session.initialized = true; detail(session, 0) } }
  }, {})
  const delegate = Delegate.new()
  sessions.set(view, { owner, container, view, rows, noteid, delegate, resume }); view.delegate = delegate
  container.addSubview(view); host.addSubview(container)
  const dragArea = new UIView({ x: 0, y: 0, width: 100, height: 52 })
  dragArea.addGestureRecognizer(new UIPanGestureRecognizer(delegate, 'historyPan:'))
  container.addSubview(dragArea)
  const list = rows.map((row, i) => {
    const at = Number(row.createdAt), date = at ? new Date(at < 1e12 ? at * 1000 : at).toLocaleString() : '日期未记录'
    const feedback = row.practice.self === 'got' ? '会了' : row.practice.self === 'again' ? '还要练' : '未反馈'
    const checked = row.commentId ? attemptAnswerChecked(noteid, row.commentId) : undefined
    return `<button class="attempt" data-index="${i}" onclick="pick(${i})"><strong>第 ${row.ordinal} 次 <em>${feedback}</em></strong><small>${escapeHtml(date)}</small><small>${escapeHtml(row.practice.reasonLabel || '未记录错因')}</small><small>${checked === undefined ? '对答案状态未记录' : checked ? '已查看答案' : '未查看答案'}</small></button>`
  }).join('')
  view.loadHTMLStringBaseURL(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:#202124;background:#f7f8fa}header{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid #ddd}button{font:inherit;cursor:pointer}header button{border:0;background:none;color:${UI_COLORS.accent};padding:10px}main{height:calc(100vh - 52px);display:flex;overflow:hidden}aside{width:260px;max-width:45vw;flex-shrink:0;overflow:auto;transition:width .2s,max-width .2s}main.folded aside{width:0;max-width:0}.attempt{display:block;width:calc(100% - 16px);margin:8px;padding:14px;text-align:left;background:white;border:1px solid #e0e3e8;border-radius:12px;white-space:normal}.attempt strong{display:flex;justify-content:space-between;gap:8px}.attempt em{font-size:12px;font-style:normal;color:${UI_COLORS.accent}}.attempt small{display:block;margin-top:7px;color:#667085}.attempt.selected{border-color:${UI_COLORS.accent};background:color-mix(in srgb,${UI_COLORS.accent} 12%,white)}#divider{width:22px;flex-shrink:0;border:0;background:transparent;touch-action:pan-y;padding:0}#divider:after{content:'';display:block;width:4px;height:36px;border-radius:3px;background:#b4bbc4;margin:auto}iframe{flex:1;min-width:0;border:0;background:white}#empty{padding:24px;color:#667085}@media(prefers-reduced-motion:reduce){aside{transition:none}}
  header strong{flex:1;align-self:stretch;display:flex;align-items:center;cursor:move;touch-action:none}main{position:relative}aside{padding-top:0;width:220px}#divider{position:absolute;z-index:2;left:calc(min(220px,45vw) + 12px);top:12px;width:40px;height:40px;border-radius:50%;background:white;border:1px solid #dce3ee;box-shadow:0 2px 6px #17203318;color:${UI_COLORS.accent};font-size:20px}#divider:after{display:none}main.folded #divider{left:12px}#grip{position:fixed;right:2px;bottom:2px;width:44px;height:44px;border:0;border-radius:12px;background:#eef2f7;color:#526075;cursor:nwse-resize;touch-action:none}button{min-height:40px}iframe{padding:60px 0 20px}header button:disabled{opacity:.4}#divider:before{content:"";position:absolute;right:6px;top:6px;width:8px;height:8px;background:#fa8a7a;border-radius:50%}header{user-select:none}
  </style></head><body><header><strong id="drag">历史作答</strong><button id="continue" disabled onclick="location.href='cardlink-history://continue'">从当前批注继续</button><button onclick="location.href='cardlink-history://close'">关闭</button></header><main id="layout"><aside>${list || '<p id="empty">暂无已保存作答</p>'}</aside><button id="divider" aria-label="收起作答列表" aria-expanded="true">☰</button><iframe id="paper" title="本次作答详情" sandbox="allow-scripts allow-same-origin" srcdoc="<p style='padding:24px'>${rows.length ? '正在读取作答…' : '暂无已保存作答'}</p>"></iframe></main><button id="grip" aria-label="拖动调节窗口大小，方向键微调">↘</button><script>
  window.historyFrame=${JSON.stringify(frame)};window.resumable=${JSON.stringify(rows.map(row => !!row.commentId && !!resume))};
  function resize(frame){location.href='cardlink-history://layout/'+encodeURIComponent(JSON.stringify(frame))}
  for(const id of ['grip']){const el=document.getElementById(id);let drag,pending,timer;
    const commit=()=>{cancelAnimationFrame(timer);timer=null;if(pending){resize(pending);pending=null}};
    el.onpointerdown=e=>{if(e.button!==0||e.isPrimary===false)return;e.preventDefault();drag={id:e.pointerId,x:e.screenX,y:e.screenY,frame:{...historyFrame}};el.setPointerCapture(e.pointerId)};
    el.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.screenX-drag.x,dy=e.screenY-drag.y;pending={...drag.frame,width:drag.frame.width+dx,height:drag.frame.height+dy};if(!timer)timer=requestAnimationFrame(commit)};
    el.onpointerup=()=>{commit();drag=null};el.onpointercancel=el.onlostpointercapture=()=>{cancelAnimationFrame(timer);timer=null;pending=null;drag=null};
  }
  document.getElementById('grip').onkeydown=e=>{const d={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(d){e.preventDefault();resize({...historyFrame,width:historyFrame.width+d[0],height:historyFrame.height+d[1]})}};
  let selected=-1;function pick(i){location.href='cardlink-history://select/'+i}window.showAttempt=function(i,html){if(selected===i)return;selected=i;document.getElementById('continue').disabled=!window.resumable[i];document.querySelectorAll('.attempt').forEach(b=>b.classList.toggle('selected',Number(b.dataset.index)===i));document.getElementById('paper').srcdoc=html};
  const layout=document.getElementById('layout'),divider=document.getElementById('divider');function fold(value){layout.classList.toggle('folded',value);layout.querySelector('aside').inert=value;layout.querySelector('aside').setAttribute('aria-hidden',String(value));divider.setAttribute('aria-expanded',String(!value));divider.setAttribute('aria-label',value?'展开作答列表':'收起作答列表')}window.addEventListener('message',e=>{if(e.source===document.getElementById('paper').contentWindow&&e.data?.type==='history-list-swipe')fold(e.data.folded)});divider.onclick=()=>fold(!layout.classList.contains('folded'));let start;layout.addEventListener('touchstart',e=>{const t=e.touches[0];start={x:t.clientX,y:t.clientY}},{passive:true});layout.addEventListener('touchend',e=>{if(!start)return;const t=e.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.5)fold(dx<0);start=null},{passive:true});
  </script></body></html>`, null)
}
