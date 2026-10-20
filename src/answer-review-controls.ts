import { UI_COLORS, WINDOW_CONTROL_BACKGROUND_OPACITY } from "./ui-tokens"
import { ANSWER_BAR_CONTROL_WIDTH, ANSWER_BAR_HEIGHT } from "./window-controls"

export const REVIEW_CONTROL_WIDTH = ANSWER_BAR_CONTROL_WIDTH * 3
export const REVIEW_CONTROL_HEIGHT = ANSWER_BAR_HEIGHT
export const REVIEW_COLLAPSED_WIDTH = 64
export const REVIEW_VISUAL_INSET = 10
export const REVIEW_LEVEL_NAMES = ["不会", "不熟", "掌握"]

/** A compact three-dot capsule expands as one group; native buttons handle input. */
export function answerReviewControlsHtml(alignLeft = false, intelligent = false): string {
  const names = intelligent ? ["不会", "不熟", "良好", "掌握"] : REVIEW_LEVEL_NAMES
  const colors = intelligent ? [UI_COLORS.level0, UI_COLORS.level1, "#3b82f6", UI_COLORS.level2] : [UI_COLORS.level0, UI_COLORS.level1, UI_COLORS.level2]
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:${REVIEW_CONTROL_HEIGHT + REVIEW_VISUAL_INSET * 2}px;overflow:hidden;background:transparent!important;-webkit-user-select:none}
.capsule{position:absolute;right:${REVIEW_VISUAL_INSET}px;top:${REVIEW_VISUAL_INSET}px;width:${REVIEW_COLLAPSED_WIDTH}px;height:${REVIEW_CONTROL_HEIGHT}px;border-radius:${REVIEW_CONTROL_HEIGHT / 2}px;display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(252,252,253,${WINDOW_CONTROL_BACKGROUND_OPACITY});box-shadow:0 4px 9px rgba(0,0,0,.18);transition:width .32s cubic-bezier(.22,1.25,.35,1),gap .28s ease}
.capsule.left{left:${REVIEW_VISUAL_INSET}px;right:auto}
.slot{display:flex;align-items:center;justify-content:center;gap:3px;width:6px;height:${REVIEW_CONTROL_HEIGHT}px;overflow:hidden;flex:none;transition:width .32s cubic-bezier(.22,1.25,.35,1)}
.dot{display:block;width:6px;height:6px;flex:none;border-radius:50%;transition:width .28s ease,height .28s ease}
.label{display:none;font:600 12px/18px -apple-system,BlinkMacSystemFont,sans-serif;color:#172033;white-space:nowrap}
.open{width:calc(100% - ${REVIEW_VISUAL_INSET * 2}px);gap:0}.open .slot{width:${100 / names.length}%}.open .dot{width:8px;height:8px}.open .label{display:block}
.compact .slot{gap:2px}.compact .dot{width:4px;height:4px}.compact .label{font-size:10px}
.disabled{opacity:.35}
@media(prefers-reduced-motion:reduce){.capsule,.slot,.dot{transition:none!important}}
</style></head><body><div class="capsule${alignLeft ? " left" : ""}" id="capsule">${names.map((label, level) => `<div class="slot"><i class="dot" style="background:${colors[level]}"></i><span class="label">${label}</span></div>`).join("")}</div>
<script>window.setReviewSelection=function(expanded,enabled,width,alignLeft){document.getElementById('capsule').className='capsule'+(alignLeft?' left':'')+(expanded?' open':'')+(enabled?'':' disabled')+(width<126?' compact':'')}</script></body></html>`
}
