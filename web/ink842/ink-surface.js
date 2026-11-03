import { getStroke } from 'perfect-freehand';
import { PAGE_WIDTH, clamp, eraseCircle, zoomAt, constrainView, rejectPalm, scribbleErase } from './ink-geometry.js';
import { useNativeTouch, createInkInputRouter, penIsDown } from './ink-input.js';
import { INK_SETTINGS_EVENT, INK_SETTINGS_KEY, FEEL_DEFAULTS, DEFAULT_INK_SETTINGS, normalizeInkSettings, loadInkSettings, saveInkSettings, strokeStyle } from './ink-settings.js';
import { isGoodnotesStyle, createGoodnotesSession, replayGoodnotesStroke } from './goodnotes-adapter.js';

import {inkToolbar} from './ink-toolbar.js';
const COLOR = '#1c2933';
function paintStroke(ctx, points, style, complete = true) {
  if (!points.length) return;
  ctx.save();
  try {
  ctx.globalAlpha = style?.kind === 'marker' ? .28 : 1;
  ctx.fillStyle = style?.color || COLOR; ctx.strokeStyle = style?.color || COLOR; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Preserve the appearance of previously submitted and saved answers.
  if (!style) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i], previous = points[Math.max(0, i - 1)];
      ctx.lineWidth = 2 + p[2] * 2;
      ctx.beginPath(); ctx.moveTo(previous[0], previous[1]); ctx.lineTo(p[0] + .01, p[1]); ctx.stroke();
    }
    return;
  }
  const outline = getStroke(points, { size: style.size, thinning: style.pressure ? .25 : 0, smoothing: .4, streamline: .1, simulatePressure: false, last: complete });
  if (!outline.length) return;
  ctx.beginPath(); ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const next = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(outline[i][0], outline[i][1], (outline[i][0] + next[0]) / 2, (outline[i][1] + next[1]) / 2);
  }
  ctx.closePath(); ctx.fill();
  } finally { ctx.restore(); }
}

function paintAnswer(ctx, answer) {
  // Keep translucent highlighting behind handwriting, regardless of drawing order.
  for (const marker of [true,false]) answer.strokes.forEach((s,i) => {
    if (answer.styles?.[i]?.engine!=='goodnotes-ink-v2'&&(answer.styles?.[i]?.kind === 'marker') === marker) {
      if(isGoodnotesStyle(answer.styles?.[i]))replayGoodnotesStroke(ctx,s,answer.styles[i]);
      else paintStroke(ctx,s,answer.styles?.[i]);
    }
  });
  answer.strokes.forEach((s,i)=>{if(answer.styles?.[i]?.engine==='goodnotes-ink-v2')replayGoodnotesStroke(ctx,s,answer.styles[i]);});
}

export function renderAnswer(canvas, answer, { background = null, backgroundHeight = answer.height } = {}) {
  canvas.width = PAGE_WIDTH; canvas.height = answer.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (background) ctx.drawImage(background, 0, 0, PAGE_WIDTH, backgroundHeight);
  paintAnswer(ctx, answer);
  return canvas;
}

export function createInkSurface(box, answer, { readonly = false, isLocked = () => false, onChange = () => {}, background = null, backgroundHeight = answer.height, fullWindow = false, extendToViewport = true, maxHeight = 16000 } = {}) {
  const viewport = document.createElement('div'); viewport.className = 'ink-viewport';
  viewport.setAttribute('role', 'group'); viewport.setAttribute('aria-label', '手写答题纸');
  const dry = document.createElement('canvas'), wet = document.createElement('canvas');
  dry.className = 'ink-dry'; wet.className = 'ink-wet';
  dry.setAttribute('aria-label', box.querySelector('canvas').getAttribute('aria-label'));
  wet.setAttribute('aria-hidden', 'true');
  if (readonly) {
    const tools = document.createElement('div'); tools.className = 'ink-tools';
    tools.innerHTML = '<button data-ink="full">全屏查看</button><button data-ink="zoom-out" aria-label="缩小答题纸">−</button><button data-ink="zoom-reset">100%</button><button data-ink="zoom-in" aria-label="放大答题纸">＋</button><button data-ink="bottom">到纸张底部</button>';
    box.querySelector('canvas').before(tools);
  }
  const status = document.createElement('span'); status.className = 'ink-view-status'; status.setAttribute('aria-live', 'polite');
  viewport.append(dry, wet, status); box.querySelector('canvas').replaceWith(viewport);
  if (!readonly) { const tools = box.querySelector('.ink-tools'); tools.innerHTML = ''; tools.insertAdjacentHTML('beforeend', inkToolbar()); }
  const hint = document.createElement('p'); hint.className = 'ink-hint';
  hint.textContent = readonly ? '单指拖动答卷 · 双指缩放' : 'GoodNotes-Ink · Pencil 写字 · 单指拖动画布 · 双指缩放';
  viewport.after(hint);
  answer.styles = answer.strokes.map((_, i) => answer.styles?.[i] || null);
  let view = { zoom: 1, x: 0, y: 0 }, width = 0, height = 0, ratio = 1;
  let pen = null, pending = null, lastPen = -Infinity, lastInkEvent = -Infinity, eraserPoint = null, erased = false;
  let settings = loadInkSettings();
  let frame = 0, dryDirty = false, disposed = false, tool = settings.tool, pinch = null;
  let transaction = null, previousOverflow = null, expanded = false, strokeStarted = 0, settingsOpen = false;
  const touches = new Map(), history = [], future = [], abort = new AbortController();
  const nativeTouch = useNativeTouch(navigator, 'ontouchstart' in window);
  const capture = id => { if (typeof id === 'number') { try { viewport.setPointerCapture(id); } catch { /* Window end listeners still finish the stroke. */ } } };
  const release = id => { if (typeof id === 'number') { try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch { /* Safari may release first. */ } } };
  const listen = (target, event, handler, extra = {}) => target.addEventListener(event, handler, { signal: abort.signal, ...extra });
  const snapshot = () => ({strokes:answer.strokes.slice(),styles:answer.styles.slice(),height:answer.height});
  function begin() { transaction = snapshot(); }
  function commit(changed = true) {
    if (!transaction) return;
    if (changed) {
      history.push(transaction); future.length = 0;
      while (history.length > 20 || (history.length > 1 && history.reduce((n, s) => n + s.strokes.reduce((m, p) => m + p.length, 0), 0) > 300000)) history.shift();
      onChange();
    }
    transaction = null; updateControls();
  }
  function updateControls() {
    const undo = box.querySelector('[data-ink="undo"]'), redo = box.querySelector('[data-ink="redo"]');
    if (undo) undo.disabled = !history.length || isLocked(); if (redo) redo.disabled = !future.length || isLocked();
    const zoom = Math.round(view.zoom * 100) + '%';
    const reset = box.querySelector('[data-ink="zoom-reset"]'); if (reset) reset.textContent = zoom;
    status.textContent = zoom;
  }
  function transform(ctx) {
    const scale = width / PAGE_WIDTH * view.zoom;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * view.x, ratio * view.y);
  }
  function clear(canvas, white = false) {
    const ctx = canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (white) { ctx.fillStyle = '#e9eee7'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    transform(ctx);
    if (white) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_WIDTH, answer.height);
      if (background) ctx.drawImage(background, 0, 0, PAGE_WIDTH, backgroundHeight);
    }
    return ctx;
  }
  function drawDry() {
    if (!width || disposed) return;
    view = constrainView(view, width, height, answer.height, 60);
    const ctx = clear(dry, true);
    clear(wet);
    paintAnswer(ctx, answer);
    if(pending)pending.session=null;
    updateControls();
  }
  function drawWet() {
    frame = 0; if (disposed || !width) return;
    if (dryDirty) { drawDry(); dryDirty = false; }
    const ctx = wet.getContext('2d');
    if (pending) renderPending();else clear(wet);
    if (eraserPoint && tool === 'eraser') { ctx.beginPath(); ctx.arc(eraserPoint[0], eraserPoint[1], settings.eraserSize / view.zoom, 0, Math.PI * 2); ctx.strokeStyle = '#70877b'; ctx.lineWidth = 1 / view.zoom; ctx.stroke(); }
  }
  function renderPending(){
    if(!pending)return;
    if(!pending.session){clear(wet);pending.session=createGoodnotesSession(dry.getContext('2d'),wet.getContext('2d'),pending.style,{commitByReplay:true});}
    pending.session.feed(pending.ended?pending.points.slice(0,-1):pending.points);
  }
  function requestWet() { if (!frame) frame = requestAnimationFrame(drawWet); }
  function resize() {
    if (disposed) return;
    width = viewport.getBoundingClientRect().width;
    if (!width) return;
    const natural = answer.height * width / PAGE_WIDTH;
    height = fullWindow ? Math.max(1, viewport.getBoundingClientRect().height) : expanded ? Math.max(220, viewport.getBoundingClientRect().height) : Math.min(natural, 520);
    if (!readonly && extendToViewport && (expanded || fullWindow)) {
      const needed = Math.min(maxHeight, Math.ceil(height * PAGE_WIDTH / width));
      if (answer.height < needed) { answer.height = needed; onChange(); }
    }
    if (!expanded && !fullWindow) viewport.style.height = height + 'px';
    ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2000000 / (width * height)));
    for (const c of [dry, wet]) { c.width = Math.max(1, Math.round(width * ratio)); c.height = Math.max(1, Math.round(height * ratio)); }
    drawDry(); requestWet();
  }
  const screenPoint = e => { const r = viewport.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function modelPoint(e) {
    const p = screenPoint(e), scale = width / PAGE_WIDTH * view.zoom;
    return [clamp((p[0] - view.x) / scale, 0, PAGE_WIDTH), clamp((p[1] - view.y) / scale, 0, answer.height), Number.isFinite(e.pressure) ? clamp(e.pressure, 0, 1) : pending?.points.at(-1)?.[2] ?? .5];
  }
  function append(e, terminal = false) {
    const point = modelPoint(e), previous = pending.points.at(-1);
    point.push(Math.min(3600000,Math.max(previous?.[3]||0,(e.timeStamp||performance.now())-strokeStarted)));
    if (tool === 'line' && pending.points.length) { pending.points = [pending.points[0],point]; pending.session=null; return; }
    if (terminal || !previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > .2) pending.points.push(point);
  }
  function erase(point) {
    const radius = settings.eraserSize / view.zoom;
    const start = eraserPoint || point, distance = Math.hypot(start[0] - point[0], start[1] - point[1]);
    const steps = Math.max(1, Math.ceil(distance / (radius / 2)));
    for (let i = 1; i <= steps; i++) {
      const center = [start[0] + (point[0] - start[0]) * i / steps, start[1] + (point[1] - start[1]) * i / steps];
      let result;
      if(settings.eraserMode==='stroke'){
        const keep=answer.strokes.map((s,i)=>!eraseCircle([s],[answer.styles[i]],center,radius).changed);
        result={changed:keep.some(v=>!v),strokes:answer.strokes.filter((_,i)=>keep[i]),styles:answer.styles.filter((_,i)=>keep[i])};
      }else result = eraseCircle(answer.strokes, answer.styles, center, radius);
      if (result.changed) { answer.strokes = result.strokes; answer.styles = result.styles; erased = true; }
    }
    eraserPoint = point; dryDirty = true; requestWet();
  }
  function finish() {
    if (pen === null) return;
    const id = pen; pen = null; lastPen = performance.now();
    let committed=false;
    if (pending?.points.length) {
      const removed = tool === 'pen' && settings.scribble && scribbleErase(answer.strokes, answer.styles, pending.points, performance.now() - strokeStarted);
      if (removed?.changed) { answer.strokes = removed.strokes; answer.styles = removed.styles; status.textContent = '已涂抹擦除，可撤销'; }
      else {
        if(!pending.ended){const last=pending.points.at(-1);pending.points.push([last[0],last[1],0,last[3]]);pending.ended=true;}
        cancelAnimationFrame(frame);frame=0;renderPending();pending.session.end(pending.points);committed=true;
        answer.strokes.push(pending.points); answer.styles.push(pending.style);
      }
      pending = null; commit();
    }
    else commit(erased);
    pending = null; eraserPoint = null; erased = false;
    release(id);
    if(!committed)drawDry();requestWet();
    if(tool==='eraser'&&settings.eraserAutoReturn){settingsOpen=false;changeSettings({tool:settings.lastDrawTool||'pen'});}
  }
  function pinchStart() {
    if (touches.size !== 2) { pinch = null; return; }
    for (const touch of touches.values()) touch.suppressScroll = true;
    const points = [...touches.values()].map(v => v.point);
    const center = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    pinch = { center, distance: Math.max(1, Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1])), view: { ...view } };
  }
  function pointerDown(e) {
    if (isLocked()) return;
    if(settingsOpen){settingsOpen=false;syncSettings();}
    if (e.pointerType === 'touch') {
      e.preventDefault();
      if(pen!==null&&!input.hasNativePen()&&performance.now()-lastInkEvent>180)finish();
      if (rejectPalm(e, pen !== null, lastPen, performance.now())) return;
      touches.set(e.pointerId, { point: screenPoint(e), clientY: e.clientY });
      capture(e.pointerId); pinchStart(); return;
    }
    if (readonly || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // A fresh contact must recover even if Safari omitted the preceding up.
    if (pen !== null) finish();
    e.preventDefault(); touches.clear(); pinch = null; pen = e.pointerId; lastPen = performance.now();
    capture(e.pointerId); begin(); strokeStarted = lastInkEvent = performance.now();
    if (tool === 'eraser') { eraserPoint = null; erased = false; erase(modelPoint(e)); }
    else { pending = { points: [], style: {...strokeStyle(settings),inputScale:width / PAGE_WIDTH * view.zoom} }; append(e); renderPending(); }
  }
  function pointerMove(e) {
    if (e.pointerType === 'pen') {
      if (!penIsDown(e)) { if (e.pointerId === pen) finish(); return; }
      if (pen === null && !readonly && !isLocked()) pointerDown(e);
    }
    if (e.pointerType === 'touch') {
      if(!touches.has(e.pointerId))pointerDown(e);
      const touch = touches.get(e.pointerId); if (!touch || pen !== null) return;
      const previous = touch.point; touch.point = screenPoint(e); touch.clientY = e.clientY;
      if (touches.size === 2 && pinch) {
        const points = [...touches.values()].map(v => v.point), center = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
        const distance = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]);
        view = zoomAt(pinch.view, pinch.view.zoom * distance / pinch.distance, pinch.center);
        view.x += center[0] - pinch.center[0]; view.y += center[1] - pinch.center[1]; drawDry(); requestWet();
      } else if (touches.size === 1 && !touch.suppressScroll) {
        const next = constrainView({ ...view, x: view.x + touch.point[0] - previous[0], y: view.y + touch.point[1] - previous[1] }, width, height, answer.height,60);
        if (next.x !== view.x || next.y !== view.y) { view = next; drawDry(); requestWet(); }
        else if (!expanded && !fullWindow) window.scrollBy(0, previous[1] - touch.point[1]);
      }
      e.preventDefault(); return;
    }
    if (e.pointerId !== pen || isLocked()) return;
    lastInkEvent=performance.now();
    e.preventDefault();
    const samples = e.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [e]) { if (tool === 'eraser') erase(modelPoint(sample)); else append(sample); }
    if(pending)renderPending();else requestWet();
  }
  const pointerEnd = e => {
    if (e.pointerId === pen) { if (pending && e.type === 'pointerup') {append(e,true);pending.ended=true;} finish(); }
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId); pinch = null; release(e.pointerId);
      for (const touch of touches.values()) touch.suppressScroll = false;
      pinchStart();
    }
  };
  const input=createInkInputRouter({down:pointerDown,move:pointerMove,end:pointerEnd});
  listen(viewport, 'pointerdown', e=>input.pointer(e), { passive: false });
  listen(viewport, 'pointermove', e=>input.pointer(e), { passive: false });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(viewport, event, e=>input.pointer(e));
  // Capture end events beyond the canvas as well, so no contact stays stuck.
  for (const event of ['pointerup', 'pointercancel']) listen(window, event, e=>input.pointer(e), { capture: true });
  if (nativeTouch) {
    for (const event of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(viewport, event, e => input.touch(e), { passive: false });
    for (const event of ['touchend','touchcancel']) listen(window,event,e=>input.touch(e,false),{capture:true,passive:false});
  }
  for (const event of ['contextmenu', 'selectstart', 'gesturestart', 'gesturechange']) listen(box, event, e => { if (e.cancelable && !e.target.closest('textarea,input,select')) e.preventDefault(); }, { passive: false });
  function resetInput(){input.reset();finish();touches.clear();pinch=null;}
  listen(document, 'visibilitychange', () => { if (document.hidden) resetInput(); });
  listen(window, 'blur', resetInput);
  listen(window, 'pagehide', resetInput);
  listen(viewport, 'wheel', e => {
    if (pen !== null || isLocked()) return;
    if (e.ctrlKey || e.metaKey) {
      view = zoomAt(view, view.zoom * Math.exp(-e.deltaY * .01), screenPoint(e));
      e.preventDefault(); drawDry(); requestWet(); return;
    }
    const next = constrainView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY }, width, height, answer.height,60);
    if (next.x !== view.x || next.y !== view.y) { view = next; e.preventDefault(); drawDry(); requestWet(); }
  }, { passive: false });
  function setExpanded(value) {
    resetInput(); expanded = value; box.classList.toggle('ink-expanded', value);
    document.documentElement.classList.toggle('ink-fullscreen', value);
    if (value) window.getSelection()?.removeAllRanges();
    const button = box.querySelector('[data-ink="full"]'); if (button) {button.setAttribute('aria-label',value?'退出全屏':'全屏书写');button.setAttribute('title',value?'退出全屏':'全屏书写');if(readonly)button.textContent=value?'退出全屏':'全屏查看';}
    if (value) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; viewport.style.height = ''; }
    else { document.body.style.overflow = previousOverflow ?? ''; previousOverflow = null; }
    resize();
  }
  listen(window, 'keydown', e => {
    if (expanded && e.key === 'Escape') { e.preventDefault(); setExpanded(false); }
  });
  box.querySelectorAll('[data-ink]').forEach(button => listen(button, 'click', () => {
    if (isLocked()) return; finish(); const action = button.dataset.ink;
    if (['pen','eraser','marker','line'].includes(action)) { settingsOpen = tool === action ? !settingsOpen : false; changeSettings({tool:action,...(action!=='eraser'?{lastDrawTool:action}:{})}); }
    if(action==='settings'){settingsOpen=!settingsOpen;syncSettings();}
    if(action==='preset')changeSettings({...FEEL_DEFAULTS,tool:'pen',lastDrawTool:'pen',penType:'fountain',size:3.5,color:'#1c1917',pressure:true});
    if (action === 'settings-close') { settingsOpen = false; syncSettings(); }
    if (action === 'undo' || action === 'redo') {
      const from = action === 'undo' ? history : future, to = action === 'undo' ? future : history;
      if (from.length) { to.push(snapshot()); Object.assign(answer, from.pop()); resize(); onChange(); }
    }
    if (action === 'grow' && answer.height < maxHeight) { begin(); answer.height = Math.min(maxHeight, answer.height + 500); resize(); commit(); }
    if (action === 'full') setExpanded(!expanded);
    if (action.startsWith('zoom-')) {
      const zoom = action === 'zoom-reset' ? 1 : view.zoom * (action === 'zoom-in' ? 1.25 : .8);
      view = zoomAt(view, zoom, [width / 2, height / 2]); drawDry(); requestWet();
    }
    if (action === 'bottom') { view.y = height - answer.height * width / PAGE_WIDTH * view.zoom; drawDry(); requestWet(); }
    updateControls();
  }));
  if (!readonly) {
    const toggle = box.querySelector('[data-scribble]');
    if (toggle) listen(toggle, 'click', () => changeSettings({scribble:!settings.scribble}));
    hint.textContent += ' · 快速来回涂抹可擦除，支持撤销';
  }
  function syncSettings() {
    for (const name of ['pen','marker','line','eraser']) {
      const button=box.querySelector(`[data-ink="${name}"]`);
      button?.setAttribute('aria-pressed',String(tool===name));
      button?.setAttribute('aria-expanded',String(tool===name && settingsOpen));
    }
    const panel=box.querySelector('[data-tool-panel]'); if(panel)panel.hidden=!settingsOpen;
    const title=box.querySelector('[data-tool-name]'); if(title)title.textContent={pen:'笔设置',marker:'荧光笔设置',line:'直线设置',eraser:'橡皮设置'}[tool];
    box.querySelectorAll('[data-ink-for]').forEach(e=>{e.hidden=!e.dataset.inkFor.split(' ').includes(tool);});
    const color = tool === 'marker' ? settings.markerColor : settings.color;
    box.querySelectorAll('[data-ink-color]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.inkColor===color)));
    box.querySelectorAll('[data-ink-quick]').forEach(b=>{const key=b.dataset.inkQuick;if(key)b.setAttribute('aria-pressed',String(String(settings[key])===b.dataset.value));});
    const preview=box.querySelector('.ink-stroke-preview');if(preview){preview.style.color=color;preview.style.strokeWidth=String(tool==='marker'?settings.markerSize/2:settings.size);}
    box.querySelectorAll('[data-ink-setting]').forEach(input => {
      const key=input.dataset.inkSetting;
      if(input.type==='checkbox')input.checked=settings[key];else input.value=key==='color'?color:key==='pressure'?(settings.pressure?'pressure':'fixed'):String(settings[key]);
    });
    box.querySelectorAll('[data-ink-value]').forEach(output=>{const key=output.dataset.inkValue,value=settings[key],unit=output.dataset.unit;output.textContent=unit==='%'?Math.round(value*100)+'%':Number(value).toFixed(unit==='×'?1:1).replace(/\.0$/,'')+unit;});
    const toggle=box.querySelector('[data-scribble]');
    if(toggle){toggle.textContent='涂抹擦除：'+(settings.scribble?'开':'关');toggle.setAttribute('aria-pressed',String(settings.scribble));}
  }
  function changeSettings(patch, persist = true) {
    if(isLocked())return;finish();settings=persist?saveInkSettings({...settings,...patch}):normalizeInkSettings({...settings,...patch});tool=settings.tool;syncSettings();
    if(persist)window.dispatchEvent(new Event(INK_SETTINGS_EVENT));
  }
  if(!readonly){
    box.querySelectorAll('[data-ink-quick]').forEach(button=>listen(button,'click',()=>{const key=button.dataset.inkQuick;if(!key)return;changeSettings({[key]:['penType','eraserMode'].includes(key)?button.dataset.value:Number(button.dataset.value)});}));
    box.querySelectorAll('[data-ink-color]').forEach(button=>listen(button,'click',()=>changeSettings({[tool==='marker'?'markerColor':'color']:button.dataset.inkColor})));
    box.querySelectorAll('[data-ink-setting]').forEach(input=>{
      const update=persist=>{const key=input.dataset.inkSetting;
        changeSettings({[key==='color'&&tool==='marker'?'markerColor':key]:input.type==='checkbox'?input.checked:key==='pressure'?input.value==='pressure':['color','penType','eraserMode'].includes(key)?input.value:Number(input.value)},persist);};
      listen(input,'input',()=>update(false));listen(input,'change',()=>update(true));
    });
    const reload=()=>{finish();settings=loadInkSettings();tool=settings.tool;syncSettings();};
    listen(window,INK_SETTINGS_EVENT,reload);
    listen(window,'storage',e=>{if(e.key===INK_SETTINGS_KEY)reload();});
    syncSettings();
  }
  const observer = new ResizeObserver(() => resize()); observer.observe(viewport);
  resize(); updateControls();
  return {
    flush: finish,
    exportImage() { finish(); const canvas = renderAnswer(document.createElement('canvas'), answer, { background, backgroundHeight }); const data = canvas.toDataURL('image/png'); canvas.width = canvas.height = 1; return data; },
    dispose() { finish(); disposed = true; abort.abort(); observer.disconnect(); cancelAnimationFrame(frame); if (previousOverflow !== null) document.body.style.overflow = previousOverflow; if (expanded) document.documentElement.classList.remove('ink-fullscreen'); dry.width = wet.width = 1; }
  };
}
