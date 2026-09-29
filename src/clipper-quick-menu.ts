import { UI_COLORS } from "./ui-tokens"

export function clipperProgressHtml(initial: { stage: string; excerptTitle: boolean; excerptAnswer?: boolean; started: boolean }): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}html,body{margin:0;background:transparent;font:12px -apple-system,BlinkMacSystemFont,sans-serif;color:#85858b}
  .progress{display:flex;height:30px;border-radius:15px;overflow:hidden;background:${UI_COLORS.grayFill}6b}
  .step{position:relative;isolation:isolate;flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:2px;transition:color .38s}
  .step::before{content:"";position:absolute;inset:0;z-index:-1;transform:scaleX(0);transform-origin:left;background:${UI_COLORS.accent};transition:transform .38s cubic-bezier(.32,.72,0,1),background .38s}
  .step.active,.step.done{color:#fff}.step.active::before,.step.done::before{transform:scaleX(1)}.step.done::before{background:${UI_COLORS.level2}}b{font-weight:400}
  @media(prefers-reduced-motion:reduce){.step,.step::before{transition:none}}
  </style></head><body><div class="progress"><span class="step"><b>1</b>标题</span><span class="step"><b>2</b>题目</span><span class="step"><b>3</b>答案</span></div>
  <script>window.updateClip=function(s){var index=['title','question','answer'].indexOf(s.stage),number=0;document.querySelectorAll('.step').forEach(function(el,i){var skip=(i===0&&!s.excerptTitle)||(i===2&&s.excerptAnswer===false);if(!skip)number++;el.style.display=skip?'none':'';el.className='step '+(s.started&&!skip&&i<index?'done':s.started&&!skip&&i===index?'active':'');el.querySelector('b').textContent=s.started&&i<index?'✓':String(number)})};window.updateClip(${JSON.stringify({ stage: initial.stage, excerptTitle: initial.excerptTitle, started: initial.started, excerptAnswer: initial.excerptAnswer }).replace(/</g, "\\u003c")})</script></body></html>`
}
