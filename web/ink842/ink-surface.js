import {PAGE_SIZES,paintPaper,inPolygon,perfectShape} from './ink-paper.js';
import { getStroke } from 'perfect-freehand';
import { PAGE_WIDTH, clamp, zoomAt, constrainView, rejectPalm, scribbleErase } from './ink-geometry.js';
import {createStrokeIndex,erasePath,unionBounds,strokeBounds,overlaps} from './ink-eraser.js';
import {createInlineInkTiles} from './inline-ink-tiles.js';
import {createInlineInkAnchors,projectInlineInk} from './inline-ink-anchors.js';
import {observeInkInput} from './ink-diagnostics.js';
import { useNativeTouch, createInkInputRouter, penIsDown } from './ink-input.js';
import { INK_SETTINGS_EVENT, INK_SETTINGS_KEY, FEEL_DEFAULTS, DEFAULT_INK_SETTINGS, normalizeInkSettings, loadInkSettings, saveInkSettings, strokeStyle } from './ink-settings.js';
import { isGoodnotesStyle, createGoodnotesSession, replayGoodnotesStroke } from './goodnotes-adapter.js';
import { getStroke as getDrawesomeStroke } from '../vendor/drawesome/engine/freehand';
import { PEN_BY_ID } from '../vendor/drawesome/engine/pens';

import {inkToolbar} from './ink-toolbar.js';
import {createInkRenderCache} from './ink-render-cache.js';
const inkRenderCache=createInkRenderCache();
const COLOR = '#1c2933';
const drawesomeHighlighter = PEN_BY_ID.highlighter;
export const isDrawesomeHighlight = style => style?.engine === 'drawesome-highlighter-v1';

function paintDrawesomeHighlight(ctx, points, style) {
  const outline = getDrawesomeStroke(points, drawesomeHighlighter.options(style.size));
  if (!outline.length) return;
  ctx.save();
  ctx.globalAlpha = drawesomeHighlighter.defaultOpacity;
  ctx.globalCompositeOperation = drawesomeHighlighter.blend;
  ctx.fillStyle = style.color;
  ctx.beginPath();
  for (const ring of outline) {
    ctx.moveTo(...ring[0]);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(...ring[i]);
    ctx.closePath();
  }
  ctx.fill(); ctx.restore();
}
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

function paintSavedStroke(ctx,points,style){
 if(isGoodnotesStyle(style))replayGoodnotesStroke(ctx,points,style);
 else paintStroke(ctx,points,style);
}
export function paintAnswer(ctx, answer, candidates, highlightCtx = ctx) {
  answer.strokes.forEach((s,i) => {
    if ((!candidates || candidates.has(s)) && isDrawesomeHighlight(answer.styles?.[i])) {
      inkRenderCache.paint(highlightCtx, s, answer.styles[i], paintDrawesomeHighlight);
    }
  });
  // Keep translucent highlighting behind handwriting, regardless of drawing order.
  for (const marker of [true,false]) answer.strokes.forEach((s,i) => {
    if(candidates&&!candidates.has(s))return;
    if (!isDrawesomeHighlight(answer.styles?.[i]) && answer.styles?.[i]?.engine!=='goodnotes-ink-v2'&&(answer.styles?.[i]?.kind === 'marker') === marker) {
      inkRenderCache.paint(ctx,s,answer.styles?.[i],paintSavedStroke);
    }
  });
  answer.strokes.forEach((s,i)=>{if((!candidates||candidates.has(s))&&answer.styles?.[i]?.engine==='goodnotes-ink-v2')inkRenderCache.paint(ctx,s,answer.styles[i],paintSavedStroke);});
}

export function renderAnswer(canvas, answer, { background = null, backgroundHeight = answer.height } = {}) {
  if (background) {
    canvas.width = PAGE_WIDTH; canvas.height = answer.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(background, 0, 0, PAGE_WIDTH, backgroundHeight);
    paintAnswer(ctx, answer);
    return canvas;
  }
  let minX=0,minY=0,maxX=answer.width||PAGE_WIDTH,maxY=answer.height;
  if(answer.pageSize==='infinite')for(const stroke of answer.strokes)for(const p of stroke){minX=Math.min(minX,p[0]-20);minY=Math.min(minY,p[1]-20);maxX=Math.max(maxX,p[0]+20);maxY=Math.max(maxY,p[1]+20);}
  const scale=Math.min(1,6000/(maxY-minY),3000/(maxX-minX),Math.sqrt(12000000/((maxX-minX)*(maxY-minY))));
  canvas.width=Math.ceil((maxX-minX)*scale);canvas.height=Math.ceil((maxY-minY)*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.scale(scale,scale);ctx.translate(-minX,-minY);paintAnswer(ctx,answer);return canvas;
}

export function createInkSurface(box, answer, {
  readonly = false, isLocked = () => false, onChange = () => {}, background = null, backgroundHeight = answer.height,
  paper = null, answerPaper = null, inlineCard = null, inlineNavigation = null, toolbar = true, toolsSettings, onToolsChange, onHistoryChange, onDiagnostic, fullWindow = false, extendToViewport = true, maxHeight = 16000
} = {}) {
  const viewport = inlineCard || document.createElement('div');
  if (!inlineCard) {
    viewport.className = 'ink-viewport';
    viewport.setAttribute('role', 'group'); viewport.setAttribute('aria-label', '手写答题纸');
  }
  const dry = document.createElement('canvas'), wet = document.createElement('canvas');
  const highlight = answerPaper && document.createElement('canvas');
  const wetHighlight = answerPaper && document.createElement('canvas');
  const hover = answerPaper && document.createElement('span');
  let highlightEnabled = Boolean(highlight && answer.styles?.some(isDrawesomeHighlight));
  if (highlight) {
    highlight.width = highlight.height = wetHighlight.width = wetHighlight.height = 1;
    highlight.className = wetHighlight.className = 'ink-highlight';
    highlight.setAttribute('aria-hidden', 'true');
    wetHighlight.setAttribute('aria-hidden', 'true');
    hover.className = 'ink-pencil-hover';
    hover.hidden = true;
    hover.setAttribute('aria-hidden', 'true');
  }
  const inlineTiles = inlineCard && createInlineInkTiles(inlineCard);
  const inlineAnchors = inlineCard && createInlineInkAnchors(inlineCard);
  dry.className = 'ink-dry'; wet.className = 'ink-wet';
  dry.setAttribute('aria-label', inlineCard ? '答案批注' : box.querySelector('canvas').getAttribute('aria-label'));
  wet.setAttribute('aria-hidden', 'true');
  if (readonly) {
    const tools = document.createElement('div'); tools.className = 'ink-tools';
    tools.innerHTML = '<button data-ink="full">全屏查看</button><button data-ink="zoom-out" aria-label="缩小答题纸">−</button><button data-ink="zoom-reset">100%</button><button data-ink="zoom-in" aria-label="放大答题纸">＋</button><button data-ink="bottom">到纸张底部</button>';
    box.querySelector('canvas').before(tools);
  }
  const status = document.createElement('span'); status.className = 'ink-view-status'; status.setAttribute('aria-live', 'polite');
  if (!inlineCard) { viewport.append(dry, wet, status); box.querySelector('canvas').replaceWith(viewport); }
  if (highlight) { dry.before(highlight, wetHighlight); viewport.append(hover); }
  if (paper) viewport.prepend(paper);
  if (!readonly && toolbar) {
    const tools = box.querySelector('.ink-tools');
    tools.innerHTML = '';
    tools.insertAdjacentHTML('beforeend', inkToolbar({ paper: Boolean(paper), inline: Boolean(inlineCard) }));
  }
  const hint = document.createElement('p'); hint.className = 'ink-hint';
  hint.textContent = readonly ? '单指拖动答卷 · 双指缩放' : 'GoodNotes-Ink · Pencil 写字 · 单指拖动画布 · 双指缩放';
  if (!inlineCard) viewport.after(hint);
  answer.styles = answer.strokes.map((_, i) => answer.styles?.[i] || null);
  let pageWidth=answer.width||PAGE_WIDTH;
  const constrain=(v,w,h,ph)=>answer.pageSize==='infinite'?{...v,zoom:clamp(v.zoom,.5,4)}:constrainView(v,w,h,ph*PAGE_WIDTH/pageWidth,answerPaper ? 0 : 60);
  let holdAnchor=null,shapeTimer=0,shapeEnabled=!answerPaper && Boolean(paper || inlineCard) && answer.shapeEnabled !== false,selection=[],lasso=null,drag=null;
  let view = { zoom: 1, x: 0, y: 0 }, width = 0, height = 0, ratio = 1;
  let pen = null, pending = null, lastPen = -Infinity, lastInkEvent = -Infinity, eraserPoint = null, erased = false;
  let settings = onToolsChange ? normalizeInkSettings(toolsSettings) : loadInkSettings();
  if (answerPaper) settings = { ...settings, penType: 'fountain',
    tool: ['pen', 'marker', 'eraser'].includes(settings.tool) ? settings.tool : 'pen',
    lastDrawTool: settings.lastDrawTool === 'marker' ? 'marker' : 'pen' };
  let frame = 0, viewDirty = false, repaintBounds = null, disposed = false, tool = settings.tool, pinch = null;
  let eraseQueue=[],eraseAnchor=null,spatialIndex=null;
  const inkIndex=()=>{if(!spatialIndex)spatialIndex=createStrokeIndex(answer.strokes,answer.styles);else spatialIndex.sync(answer.strokes,answer.styles);return spatialIndex;};
  let transaction = null, previousOverflow = null, expanded = false, strokeStarted = 0, settingsOpen = false;
  let glideFrame = 0;
  const touches = new Map(), history = [], future = [], listeners = [];
  const nativeTouch = useNativeTouch(navigator, 'ontouchstart' in window);
  onDiagnostic?.('web.capabilities',Number('PointerEvent' in window),Number(nativeTouch),Number(Boolean(window.visualViewport)),navigator.maxTouchPoints || 0);
  const capture = (id, target = viewport) => { if (typeof id === 'number') { try { target.setPointerCapture(id); } catch { onDiagnostic?.('engine.capture-failed',id); } } };
  const release = (id, target = viewport) => { if (typeof id === 'number') { try { if (target.hasPointerCapture(id)) target.releasePointerCapture(id); } catch { /* Safari may release first. */ } } };
  const listen = (target, event, handler, extra = {}) => {
    target.addEventListener(event, handler, extra);
    listeners.push(() => target.removeEventListener(event, handler, extra));
  };
  const reportAnchor = (inlineCard || answerPaper) && onDiagnostic
    ? observeInkInput(viewport, listen, onDiagnostic, () => !isLocked() && (!inlineCard || inlineCard.classList.contains('answer-ink-writing'))) : undefined;
  function reportGeometry() {
    if (!onDiagnostic) return;
    const rect = viewport.getBoundingClientRect(), visual = window.visualViewport;
    onDiagnostic('view.geometry',width,height,Math.round(rect.width),Math.round(rect.height),
      Math.round((visual?.scale || 1) * 100),Math.round(visual?.offsetTop || 0),Math.round(window.scrollY || 0));
    onDiagnostic('view.viewport',Math.round(rect.left),Math.round(rect.top),
      Math.round(visual?.width || window.innerWidth),Math.round(visual?.height || window.innerHeight),
      Math.round(visual?.offsetLeft || 0),Math.round(visual?.pageTop || 0));
    reportAnchor?.();
  }
  const snapshot = () => ({...answer, width:answer.width, pageSize:answer.pageSize, background:answer.background,
    shapeEnabled:answer.shapeEnabled, strokes:answer.strokes.slice(), styles:answer.styles.slice()});
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
    const canUndo = Boolean(history.length), canRedo = Boolean(future.length);
    if (undo) undo.disabled = !canUndo || isLocked(); if (redo) redo.disabled = !canRedo || isLocked();
    onHistoryChange?.(canUndo, canRedo);
    const zoom = Math.round(view.zoom * 100) + '%';
    const reset = box.querySelector('[data-ink="zoom-reset"]'); if (reset) reset.textContent = zoom;
    if (!answerPaper) status.textContent = zoom;
  }
  function transform(ctx) {
    const scale = width / pageWidth * view.zoom;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * view.x, ratio * view.y);
  }
  function paintBackground(ctx, bounds, scale) {
    if (!paper && !inlineCard) {
      ctx.fillStyle='#e9eee7';ctx.fillRect(bounds.minX,bounds.minY,bounds.maxX-bounds.minX,bounds.maxY-bounds.minY);
      ctx.fillStyle='#fff';ctx.fillRect(0,0,pageWidth,answer.height);
      if (background) ctx.drawImage(background, 0, 0, PAGE_WIDTH, backgroundHeight);
    }
    paintPaper(ctx,answer,bounds,scale);
  }
  function clear(canvas) {
    const ctx = canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    transform(ctx);
    return ctx;
  }
  function sizeCanvas(canvas) {
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }
  function drawDry() {
    if (!width || disposed) return;
    viewDirty=false;
    if (inlineTiles) { drawInlineDry(); updateControls(); return; }
    view = constrain(view, width, height, answer.height);
    const ctx = clear(dry);
    clear(wet);
    if (highlightEnabled) clear(wetHighlight);
    const scale=width/pageWidth*view.zoom;
    const visible={minX:-view.x/scale,minY:-view.y/scale,maxX:(width-view.x)/scale,maxY:(height-view.y)/scale};
    if (paper) {
      paper.style.height = answer.height + 'px';
      paper.style.transform = `translate(${view.x}px, ${view.y}px) scale(${scale})`;
      viewport.classList.toggle('ink-infinite', answer.pageSize === 'infinite');
    }
    paintBackground(ctx,visible,scale);
    paintAnswer(ctx, answer,inkIndex().query(visible), highlightEnabled ? clear(highlight) : ctx);
    repaintBounds=null;
    if(pending)pending.session=null;
    updateControls();
  }
  function drawWet() {
    frame = 0; if (disposed || !width) return;
    if(viewDirty && !inlineTiles) drawDry();
    flushEraseQueue();
    if (inlineTiles) {
      if (viewDirty) { viewDirty = false; reportGeometry(); }
      const tiles = drawInlineDry(repaintBounds, !repaintBounds);
      repaintBounds = null;
      drawInlineWet(tiles);
      return;
    }
    if(repaintBounds){drawRegion(repaintBounds);repaintBounds=null;}
    const ctx = wet.getContext('2d');
    if (isDrawesomeHighlight(pending?.style)) {
      paintDrawesomeHighlight(clear(wetHighlight), pending.points, pending.style);
    } else if (pending) renderPending();
    else { clear(wet); if (highlightEnabled) clear(wetHighlight); }
    paintToolFeedback(ctx);
  }
  function paintToolFeedback(ctx) {
    if(lasso?.length){ctx.beginPath();ctx.moveTo(...lasso[0]);for(const p of lasso)ctx.lineTo(...p);ctx.strokeStyle='#2563eb';ctx.lineWidth=2/view.zoom;ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);}
    for(const i of selection){const points=answer.strokes[i];if(!points)continue;ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(const p of points)ctx.lineTo(p[0],p[1]);ctx.strokeStyle='#2563eb66';ctx.lineWidth=8/view.zoom;ctx.stroke();}
    if (eraserPoint && tool === 'eraser') { ctx.beginPath(); ctx.arc(eraserPoint[0], eraserPoint[1], eraserRadius(), 0, Math.PI * 2); ctx.strokeStyle = '#70877b'; ctx.lineWidth = 1 / view.zoom; ctx.stroke(); }
  }
  function drawInlineDry(bounds, onlyNew = false) {
    const index = inkIndex();
    const tiles = inlineTiles.update(width,height,pageWidth);
    for (const tile of tiles) {
      if (!tile.dirty && (onlyNew || (bounds && !overlaps(bounds,tile.bounds)))) continue;
      const candidates = index.query(tile.bounds);
      if (!candidates.size) { inlineTiles.drop(tile,'dry'); tile.dirty = false; continue; }
      const ctx = inlineTiles.context(tile,'dry',true);
      tile.dirty = !ctx;
      if (ctx) paintAnswer(ctx,answer,candidates);
      else onDiagnostic?.('render.context-unavailable','dry');
    }
    if (onDiagnostic) onDiagnostic('render.tiles',tiles.length,tiles.filter(tile=>tile.dry).length);
    return tiles;
  }
  function drawInlineWet(tiles) {
    const bounds = pending?.points.length ? strokeBounds(pending.points.slice(),pending.style,true) : null;
    const feedback = lasso?.length || selection.length || eraserPoint;
    for (const tile of tiles) {
      const drawStroke = bounds && overlaps(bounds,tile.bounds);
      if (!drawStroke && !feedback) { inlineTiles.drop(tile,'wet'); tile.preview = null; continue; }
      const incremental = drawStroke && !pending.shape && tool !== 'line' && !feedback;
      const ctx = inlineTiles.context(tile,'wet',!incremental);
      if (!ctx) continue;
      if (incremental) {
        if (tile.preview !== pending) {
          tile.session = createGoodnotesSession(ctx,ctx,pending.style,{commitByReplay:true});
          tile.preview = pending;
        }
        tile.session.feed(pending.points);
      } else {
        tile.preview = null;
        if (drawStroke) paintSavedStroke(ctx,pending.points,pending.style);
      }
      if (feedback) paintToolFeedback(ctx);
    }
  }
  function drawRegion(bounds){
    if(!width||disposed)return;
    if (inlineTiles) { drawInlineDry(bounds); return; }
    const scale=width/pageWidth*view.zoom;
    const b={minX:Math.max(bounds.minX,-view.x/scale),minY:Math.max(bounds.minY,-view.y/scale),maxX:Math.min(bounds.maxX,(width-view.x)/scale),maxY:Math.min(bounds.maxY,(height-view.y)/scale)};
    if(b.maxX<=b.minX||b.maxY<=b.minY)return;
    // Clip on physical pixel boundaries: fractional clipping repeatedly blends
    // old/new edge pixels and leaves faint seams beside neighbouring strokes.
    const ds=ratio*scale,ox=ratio*view.x,oy=ratio*view.y;
    b.minX=(Math.floor(b.minX*ds+ox)-ox)/ds;b.maxX=(Math.ceil(b.maxX*ds+ox)-ox)/ds;
    b.minY=(Math.floor(b.minY*ds+oy)-oy)/ds;b.maxY=(Math.ceil(b.maxY*ds+oy)-oy)/ds;
    const ctx=dry.getContext('2d');ctx.save();transform(ctx);ctx.beginPath();ctx.rect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);ctx.clip();
    ctx.clearRect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);
    const highlights = highlightEnabled ? highlight.getContext('2d') : null;
    if (highlights) {
      highlights.save(); transform(highlights); highlights.beginPath();
      highlights.rect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY); highlights.clip();
      highlights.clearRect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);
    }
    paintBackground(ctx,b,scale);paintAnswer(ctx,answer,inkIndex().query(b),highlights||ctx);
    highlights?.restore();ctx.restore();
  }
  function renderPending(){
    if(!pending)return;
    if (isDrawesomeHighlight(pending.style)) { requestWet(); return; }
    if (inlineTiles) { requestWet(); return; }
    if(pending.shape){clear(wet);paintStroke(wet.getContext('2d'),pending.points,pending.style);return;}
    if(!pending.session){clear(wet);pending.session=createGoodnotesSession(dry.getContext('2d'),wet.getContext('2d'),pending.style,{commitByReplay:true});}
    pending.session.feed(pending.ended?pending.points.slice(0,-1):pending.points);
  }
  function requestWet() { if (!frame) frame = requestAnimationFrame(drawWet); }
  function requestView(){
    if (inlineNavigation) {
      view = inlineNavigation.apply(view);
      requestWet();
      return;
    }
    if (paper || answerPaper) { view=constrain(view,width,height,answer.height);viewDirty=true;updateControls(); }
    else drawDry();
    requestWet();
  }
  function projectAnchors() {
    const boxFor = inlineAnchors.layout(pageWidth);
    let moved = 0;
    answer.strokes.forEach((points, index) => {
      const projected = projectInlineInk(points, answer.styles[index], boxFor);
      if (!projected) return;
      answer.strokes[index] = projected.points;
      answer.styles[index] = projected.style;
      moved++;
    });
    if (moved) {
      spatialIndex = null;
      onDiagnostic?.('view.ink-reprojected',moved);
    }
    if (pending) {
      const projected = projectInlineInk(pending.points,pending.style,boxFor);
      if (projected) {
        const raw = pending.raw && projectInlineInk(pending.raw.points,pending.raw.style,boxFor);
        pending = { ...pending, ...projected, session:null,
          ...(raw ? { raw:{ ...pending.raw, ...raw, session:null } } : {}) };
        holdAnchor = pending.points[pending.points.length - 1];
      }
    }
  }
  function resize() {
    if (disposed) return;
    pageWidth=answer.width||PAGE_WIDTH;
    width = inlineCard ? viewport.clientWidth : viewport.getBoundingClientRect().width;
    if (!width) return;
    if (inlineCard) {
      height = Math.max(1, viewport.clientHeight);
      answer.height = Math.max(1, Math.ceil(height * PAGE_WIDTH / width));
      projectAnchors();
      reportGeometry();
      drawDry(); requestWet(); return;
    } else {
    if (paper) paper.style.width = pageWidth + 'px';
    if (paper && !answerPaper && paper.firstElementChild) {
      answer.height = Math.min(maxHeight, Math.max(answer.height, Math.ceil(paper.firstElementChild.offsetHeight)));
    }
    const natural = answer.height * width / pageWidth;
    height = fullWindow ? Math.max(1, viewport.getBoundingClientRect().height) : expanded ? Math.max(220, viewport.getBoundingClientRect().height) : Math.min(natural, 520);
    if (!readonly && extendToViewport && (expanded || fullWindow)) {
      const needed = Math.min(maxHeight, Math.ceil(height * pageWidth / width));
      if (answer.height < needed) { answer.height = needed; onChange(); }
    }
    if (!expanded && !fullWindow) viewport.style.height = height + 'px';
    }
    ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2000000 / (width * height)));
    sizeCanvas(dry); sizeCanvas(wet);
    if (highlightEnabled) { sizeCanvas(highlight); sizeCanvas(wetHighlight); }
    drawDry(); requestWet();
  }
  const screenPoint = e => {
    const rect = viewport.getBoundingClientRect();
    if (inlineCard) {
      const scale = width / rect.width;
      return [(e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale];
    }
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  let hoverPoint, hoverDistance;
  function hidePencilHover() {
    hoverPoint = hoverDistance = undefined;
    if (hover) hover.hidden = true;
  }
  function showPencilHover() {
    if (!hoverPoint || pen !== null || touches.size || isLocked()) return;
    const zoom = width / pageWidth * view.zoom;
    const [x, y] = screenPoint(hoverPoint);
    if (x < view.x || y < view.y || x > view.x + pageWidth * zoom || y > view.y + answer.height * zoom) {
      hover.hidden = true;
      return;
    }
    const distance = hoverDistance && performance.now() - hoverDistance.at < 150 &&
      Math.hypot(hoverPoint.clientX - hoverDistance.x, hoverPoint.clientY - hoverDistance.y) < 40
      ? hoverDistance.z : 0;
    const size = tool === 'marker' ? settings.markerSize : tool === 'eraser' ? eraserRadius() * 2 : settings.size;
    const diameter = Math.max(4, size * zoom) * (1 - .55 * distance);
    Object.assign(hover.style, { left: x + 'px', top: y + 'px', width: diameter + 'px', height: diameter + 'px',
      color: tool === 'marker' ? settings.markerColor : tool === 'eraser' ? '#70877b' : settings.color });
    hover.hidden = false;
  }
  function setPencilHoverDistance(x, y, z) {
    if (!hover) return;
    if (z === null) { hidePencilHover(); return; }
    if (![x, y, z].every(Number.isFinite) || z < 0 || z > 1) return;
    hoverDistance = { x, y, z, at: performance.now() };
    showPencilHover();
  }
  function modelPoint(e) {
    const p = screenPoint(e), scale = width / pageWidth * (inlineCard ? 1 : view.zoom);
    const x = (p[0] - (inlineCard ? 0 : view.x)) / scale;
    const y = (p[1] - (inlineCard ? 0 : view.y)) / scale;
    return [answer.pageSize==='infinite' ? x : clamp(x,0,pageWidth), answer.pageSize==='infinite' ? y : clamp(y,0,answer.height), Number.isFinite(e.pressure) ? clamp(e.pressure, 0, 1) : pending?.points[pending.points.length - 1]?.[2] ?? .5];
  }
  const gesturePoint = e => inlineNavigation ? inlineNavigation.point(e) : screenPoint(e);
  function append(e, terminal = false) {
    const point = modelPoint(e);
    if (pending.shape) {
      if (terminal || Math.hypot(point[0] - holdAnchor[0], point[1] - holdAnchor[1]) <= 6) return;
      onDiagnostic?.('engine.shape-resumed',pen);
      pending = { ...pending.raw, session: null };
    }
    const previous = pending.points[pending.points.length - 1];
    if (!terminal && (!holdAnchor || Math.hypot(point[0] - holdAnchor[0], point[1] - holdAnchor[1]) > 2)) {
      holdAnchor = point;
      clearTimeout(shapeTimer);
      if (shapeEnabled && tool === 'pen') shapeTimer = setTimeout(() => {
        if (!pending || pen === null) return;
        const shape = perfectShape(pending.points);
        if (!shape) return;
        onDiagnostic?.('engine.shape-preview',pen,pending.points.length);
        const anchor = pending.style.anchor;
        pending = { raw: pending, points: shape, shape: true, style: { size:settings.size, color:settings.color, pressure:false, kind:'pen', ...(anchor ? { anchor } : {}) } };
        requestWet();
        status.textContent = '已整理形状 · 可撤销';
      }, 650);
    }
    point.push(Math.min(3600000,Math.max(previous?.[3]||0,(e.timeStamp||performance.now())-strokeStarted)));
    if (tool === 'line' && pending.points.length) { pending.points = [pending.points[0],point]; pending.session=null; return; }
    if (terminal || !previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > .2) pending.points.push(point);
  }
  function erase(point) {
    const previous=eraseQueue[eraseQueue.length - 1]||eraseAnchor;
    if(!previous||Math.hypot(point[0]-previous[0],point[1]-previous[1])>.05)eraseQueue.push(point);
    eraserPoint=point;requestWet();
  }
  function eraserRadius() {
    return settings.eraserSize / (view.zoom * (answerPaper ? width / pageWidth : 1));
  }
  function flushEraseQueue(){
    if(!eraseQueue.length)return;
    const path=eraseAnchor?[eraseAnchor,...eraseQueue]:eraseQueue;
    eraseAnchor=path[path.length - 1];eraseQueue=[];
    const result=erasePath(answer.strokes,answer.styles,path,eraserRadius(),{wholeStroke:settings.eraserMode==='stroke',index:inkIndex()});
    if(result.changed){answer.strokes=result.strokes;answer.styles=result.styles;erased=true;repaintBounds=unionBounds(repaintBounds,result.dirty);}
  }
  function finish(reason = 'command') {
    clearTimeout(shapeTimer);holdAnchor=null;
    if (pen === null) return;
    flushEraseQueue();
    const id = pen; pen = null; lastPen = performance.now();
    if (onDiagnostic) onDiagnostic('engine.finish',id,reason,tool,pending?.points.length || 0,Math.round(lastPen-strokeStarted));
    if(tool==='lasso'){if(lasso?.length>2)selection=answer.strokes.flatMap((stroke,i)=>stroke.some(p=>inPolygon(p,lasso))?[i]:[]);lasso=null;commit(!!drag);drag=null;drawDry();requestWet();release(id);return;}
    if (pending?.points.length) {
      const removed = !pending.shape && tool === 'pen' && settings.scribble &&
        scribbleErase(answer.strokes, answer.styles, pending.points, performance.now() - strokeStarted, inkIndex(), pending.style.inputScale);
      if (removed?.changed) {
        onDiagnostic?.('engine.scribble-erase',id,pending.points.length);
        answer.strokes = removed.strokes; answer.styles = removed.styles; repaintBounds=unionBounds(repaintBounds,removed.dirty);
        status.textContent = '已涂抹擦除，可撤销';
      }
      else {
        if(!pending.ended){const last=pending.points[pending.points.length - 1];pending.points.push([last[0],last[1],0,last[3]]);pending.ended=true;}
        if (!inlineTiles) {
          cancelAnimationFrame(frame);frame=0;
          if (isDrawesomeHighlight(pending.style)) {
            paintDrawesomeHighlight(highlight.getContext('2d'),pending.points,pending.style);
            clear(wetHighlight);
          } else {
            renderPending();if(pending.shape)paintSavedStroke(dry.getContext('2d'),pending.points,pending.style);else pending.session.end(pending.points);
          }
        }
        answer.strokes.push(pending.points); answer.styles.push(pending.style);
        onDiagnostic?.('engine.commit',id,pending.points.length);
        spatialIndex?.add(pending.points,pending.style);spatialIndex?.track(answer.strokes);
        if (inlineTiles) {
          const bounds = strokeBounds(pending.points,pending.style,true);
          const tiles = drawInlineDry(bounds);
          if (onDiagnostic) onDiagnostic('render.commit',id,tiles.filter(tile=>tile.dry&&!tile.dirty&&overlaps(bounds,tile.bounds)).length);
        }
      }
      pending = null; commit();
    }
    else commit(erased);
    pending = null; eraserPoint = null; erased = false;eraseAnchor=null;eraseQueue=[];
    release(id);
    if(repaintBounds){drawRegion(repaintBounds);repaintBounds=null;}requestWet();
    if(tool==='eraser'&&settings.eraserAutoReturn){settingsOpen=false;changeSettings({tool:settings.lastDrawTool||'pen'});}
  }
  function pinchStart() {
    if (touches.size !== 2) { pinch = null; return; }
    for (const touch of touches.values()) touch.suppressScroll = true;
    const points = [...touches.values()].map(v => v.point);
    const center = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    pinch = { center, distance: Math.max(1, Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1])), view: { ...view } };
  }
  function stopGlide() {
    if (glideFrame) cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  }
  function pan(x, y) {
    const next = constrain({ ...view, x: view.x + x, y: view.y + y }, width, height, answer.height);
    if (next.x === view.x && next.y === view.y) return false;
    view = next;
    requestView();
    return true;
  }
  function glide(touch) {
    let { vx = 0, vy = 0, movedAt: previous } = touch;
    if (!answerPaper || touch.suppressScroll || performance.now() - previous > 85 ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || Math.hypot(vx, vy) < .08) return;
    function step(now) {
      const elapsed = clamp(now - previous, 1, 32);
      previous = now;
      const old = view;
      glideFrame = 0;
      if (!pan(vx * elapsed, vy * elapsed)) return;
      const decay = Math.exp(-elapsed / 180);
      vx = old.x === view.x ? 0 : vx * decay;
      vy = old.y === view.y ? 0 : vy * decay;
      if (Math.hypot(vx, vy) >= .025) glideFrame = requestAnimationFrame(step);
    }
    glideFrame = requestAnimationFrame(step);
  }
  function pointerDown(e) {
    hidePencilHover();
    if (isLocked()) return;
    stopGlide();
    if (answerPaper) status.textContent = '';
    if(settingsOpen){settingsOpen=false;syncSettings();}
    if (e.pointerType === 'touch') {
      e.preventDefault();
      if(pen!==null&&!input.hasNativePen()&&performance.now()-lastInkEvent>180)finish('stale-pen-touch');
      if (rejectPalm(e, pen !== null, lastPen, performance.now())) return;
      touches.set(e.pointerId, { point: gesturePoint(e), movedAt: performance.now() });
      capture(e.pointerId, inlineNavigation?.viewport);
      pinchStart(); return;
    }
    if (readonly || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // A fresh contact must recover even if Safari omitted the preceding up.
    if (pen !== null) finish('new-down');
    e.preventDefault(); touches.clear(); pinch = null; pen = e.pointerId; lastPen = performance.now();
    if(viewDirty)drawDry();
    capture(e.pointerId); begin(); strokeStarted = lastInkEvent = performance.now();
    onDiagnostic?.('engine.down',e.pointerType,e.pointerId,tool);
    if(tool==='lasso'){const point=modelPoint(e);const hit=selection.some(i=>answer.strokes[i]?.some(p=>Math.hypot(p[0]-point[0],p[1]-point[1])<24/view.zoom));if(hit)drag={point,original:answer.strokes.slice()};else{selection=[];lasso=[point.slice(0,2)];}requestWet();return;}
    if (tool === 'eraser') { eraserPoint = null; erased = false;eraseQueue=[];eraseAnchor=null;erase(modelPoint(e)); }
    else {
      const anchor = inlineAnchors?.at(e,pageWidth) || answerPaper?.anchorAt(modelPoint(e));
      const style = answerPaper && tool === 'marker'
        ? { engine: 'drawesome-highlighter-v1', kind: 'marker', size: settings.markerSize, pressure: false, color: settings.markerColor }
        : {...strokeStyle(settings),inputScale:width / pageWidth * (inlineCard ? 1 : view.zoom)};
      if (isDrawesomeHighlight(style) && !highlightEnabled) {
        highlightEnabled = true;
        sizeCanvas(highlight); sizeCanvas(wetHighlight);
        clear(highlight);
      }
      pending = { points: [], style: { ...style, ...(anchor ? { anchor } : {}) } };
      append(e); renderPending();
    }
  }
  function pointerMove(e) {
    if (e.pointerType === 'pen') {
      if (!penIsDown(e)) { if (e.pointerId === pen) finish('pen-no-contact'); return; }
      if (pen === null && !readonly && !isLocked()) pointerDown(e);
    }
    if (e.pointerType === 'touch') {
      if(!touches.has(e.pointerId))pointerDown(e);
      const touch = touches.get(e.pointerId); if (!touch || pen !== null) return;
      const previous = touch.point; touch.point = gesturePoint(e);
      if (touches.size === 2 && pinch) {
        const points = [...touches.values()].map(v => v.point), center = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
        const distance = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]);
        view = zoomAt(pinch.view, pinch.view.zoom * distance / pinch.distance, pinch.center);
        view.x += center[0] - pinch.center[0]; view.y += center[1] - pinch.center[1]; requestView();
      } else if (touches.size === 1 && !touch.suppressScroll) {
        if (inlineNavigation) {
          view = { ...view, x: view.x + touch.point[0] - previous[0], y: view.y + touch.point[1] - previous[1] };
          requestView();
          return;
        }
        const dx = touch.point[0] - previous[0], dy = touch.point[1] - previous[1];
        if (answerPaper && (dx || dy)) {
          const now = performance.now(), elapsed = clamp(now - touch.movedAt, 8, 85);
          touch.vx = clamp(dx / elapsed, -3, 3); touch.vy = clamp(dy / elapsed, -3, 3);
          touch.movedAt = now;
        }
        if (!pan(dx, dy) && !expanded && !fullWindow) window.scrollBy(0, -dy);
      }
      e.preventDefault(); return;
    }
    if (e.pointerId !== pen || isLocked()) return;
    lastInkEvent=performance.now();
    e.preventDefault();
    if(tool==='lasso'){const p=modelPoint(e);if(drag){let dx=p[0]-drag.point[0],dy=p[1]-drag.point[1];if(answer.pageSize!=='infinite'){const pts=selection.flatMap(i=>drag.original[i]);dx=clamp(dx,-Math.min(...pts.map(p=>p[0])),pageWidth-Math.max(...pts.map(p=>p[0])));dy=clamp(dy,-Math.min(...pts.map(p=>p[1])),answer.height-Math.max(...pts.map(p=>p[1])));}for(const i of selection)answer.strokes[i]=drag.original[i].map(p=>[p[0]+dx,p[1]+dy,...p.slice(2)]);spatialIndex=null;drawDry();}else lasso?.push(p.slice(0,2));requestWet();return;}
    const samples = e.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [e]) { if (tool === 'eraser') erase(modelPoint(sample)); else append(sample); }
    onDiagnostic?.('engine.move',e.pointerType,e.pointerId,samples.length || 1,pending?.points.length || 0);
    if(pending)renderPending();else requestWet();
  }
  const pointerEnd = e => {
    if (e.pointerId === pen) { if(e.type==='pointerup'){if(pending&&!pending.shape){append(e,true);pending.ended=true;}else if(tool==='eraser')erase(modelPoint(e));} finish(e.type); }
    if (touches.has(e.pointerId)) {
      const touch = touches.get(e.pointerId);
      touches.delete(e.pointerId); pinch = null; release(e.pointerId, inlineNavigation?.viewport);
      if (!touches.size && e.type === 'pointerup') glide(touch);
      for (const remaining of touches.values()) {
        remaining.suppressScroll = false;
        remaining.vx = remaining.vy = 0;
        remaining.movedAt = performance.now();
      }
      pinchStart();
    }
  };
  const input=createInkInputRouter({down:pointerDown,move:pointerMove,end:pointerEnd},onDiagnostic,{finishPenOnPointerUp:Boolean(inlineCard || answerPaper)});
  const inlineControls = e => inlineCard && e.target.closest?.('.cardlink-answer-ink-tools');
  const inputArea = inlineNavigation?.viewport || viewport;
  const acceptsPointer = e => !inlineCard || (!isLocked() && !inlineControls(e) &&
    (e.pointerType === 'touch' ? inlineNavigation && !e.target.closest?.('summary') : !inlineNavigation || viewport.contains(e.target)));
  for (const event of ['pointerdown','pointermove']) listen(inputArea, event, e=>{
    if (!acceptsPointer(e)) return;
    if (hover && e.pointerType === 'pen' && e.type === 'pointermove' && !penIsDown(e) && pen === null && !touches.size && !isLocked()) {
      hoverPoint = e;
      showPencilHover();
    } else if (hover) hidePencilHover();
    input.pointer(e);
  }, { passive: false });
  if (hover) {
    listen(inputArea, 'pointerleave', hidePencilHover);
    listen(inputArea, 'pointercancel', hidePencilHover);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(inputArea, event, e=>input.pointer(e));
  // Capture end events beyond the canvas as well, so no contact stays stuck.
  for (const event of ['pointerup', 'pointercancel']) listen(window, event, e=>input.pointer(e), { capture: true });
  if (nativeTouch) {
    for (const event of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(inputArea, event, e => {
      if (!inlineCard || (!isLocked() && !inlineControls(e) && (!inlineNavigation || !e.target.closest?.('summary')))) {
        input.touch(e, true, Boolean(inlineCard && !inlineNavigation), Boolean(inlineNavigation && !viewport.contains(e.target)));
      }
    }, { passive: false });
    for (const event of ['touchend','touchcancel']) listen(window,event,e=>input.touch(e,false),{capture:true,passive:false});
  }
  if (!inlineCard || inlineNavigation) {
    for (const event of ['contextmenu', 'selectstart', 'gesturestart', 'gesturechange']) {
      listen(inlineNavigation?.viewport || box, event, e => {
        if (!e.cancelable || e.target.closest('textarea,input,select')) return;
        if (inlineNavigation && (!inlineCard.classList.contains('answer-ink-writing') || inlineControls(e))) return;
        e.preventDefault();
      }, { passive: false });
    }
  }
  function resetInput(event){hidePencilHover();stopGlide();if (pen !== null) onDiagnostic?.('engine.reset',event?.type || 'command');input.reset();finish();touches.clear();pinch=null;}
  listen(document, 'visibilitychange', () => { if (document.hidden) resetInput(); });
  listen(window, 'blur', resetInput);
  listen(window, 'pagehide', resetInput);
  listen(inputArea, 'wheel', e => {
    if ((inlineCard && (!inlineNavigation || inlineControls(e))) || pen !== null || isLocked()) return;
    hidePencilHover();
    stopGlide();
    if (e.ctrlKey || e.metaKey) {
      view = zoomAt(view, view.zoom * Math.exp(-e.deltaY * .01), gesturePoint(e));
      e.preventDefault(); requestView(); return;
    }
    if (inlineNavigation) {
      const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? inputArea.clientHeight : 1;
      view = { ...view, x: view.x - e.deltaX * step, y: view.y - e.deltaY * step };
      e.preventDefault(); requestView(); return;
    }
    if (pan(-e.deltaX, -e.deltaY)) e.preventDefault();
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
  function selectTool(action) {
    changeSettings({tool:action,...(action!=='eraser'?{lastDrawTool:action}:{})});
  }
  function changeHistory(from, to) {
    if (isLocked()) return;
    finish();
    if (!from.length) return;
    to.push(snapshot()); Object.assign(answer, from.pop()); selection=[]; spatialIndex=null; resize(); onChange();
  }
  box.querySelectorAll('[data-ink]').forEach(button => listen(button, 'click', () => {
    if (isLocked()) return; finish(); const action = button.dataset.ink;
    if (['pen','eraser','marker','line','lasso'].includes(action)) { settingsOpen = tool === action ? !settingsOpen : false; selectTool(action); }
    if(action==='selection-delete'&&selection.length){begin();answer.styles=answer.styles.filter((_,i)=>!selection.includes(i));answer.strokes=answer.strokes.filter((_,i)=>!selection.includes(i));selection=[];spatialIndex=null;commit();drawDry();requestWet();}
    if(action==='settings'){settingsOpen=!settingsOpen;syncSettings();}
    if(action==='preset')changeSettings({...FEEL_DEFAULTS,tool:'pen',lastDrawTool:'pen',penType:'fountain',size:DEFAULT_INK_SETTINGS.size,color:DEFAULT_INK_SETTINGS.color,pressure:true});
    if (action === 'settings-close') { settingsOpen = false; syncSettings(); }
    if (action === 'undo') changeHistory(history, future);
    if (action === 'redo') changeHistory(future, history);
    if (action === 'grow' && answer.height < maxHeight) { begin(); answer.height = Math.min(maxHeight, answer.height + 500); resize(); commit(); }
    if (action === 'full') setExpanded(!expanded);
    if (action.startsWith('zoom-')) {
      const zoom = action === 'zoom-reset' ? 1 : view.zoom * (action === 'zoom-in' ? 1.25 : .8);
      view = zoomAt(view, zoom, [width / 2, height / 2]); drawDry(); requestWet();
    }
    if (action === 'bottom') { view.y = height - answer.height * width / pageWidth * view.zoom; drawDry(); requestWet(); }
    updateControls();
  }));
  if (!readonly) {
    const toggle = box.querySelector('[data-scribble]');
    if (toggle) listen(toggle, 'click', () => changeSettings({scribble:!settings.scribble}));
    hint.textContent += ' · 快速来回涂抹可擦除，支持撤销';
  }
  function syncSettings() {
    for (const name of ['pen','marker','line','eraser','lasso']) {
      const button=box.querySelector(`[data-ink="${name}"]`);
      button?.setAttribute('aria-pressed',String(tool===name));
      button?.setAttribute('aria-expanded',String(tool===name && settingsOpen));
    }
    const panel=box.querySelector('[data-tool-panel]'); if(panel)panel.hidden=!settingsOpen;
    const title=box.querySelector('[data-tool-name]'); if(title)title.textContent={pen:answerPaper?'钢笔设置':'笔设置',marker:'荧光笔设置',line:'直线设置',eraser:'橡皮设置',lasso:'套索：圈选后拖动，菜单可删除'}[tool];
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
    if(isLocked())return;finish();
    settings=persist&&!onToolsChange?saveInkSettings({...settings,...patch}):normalizeInkSettings({...settings,...patch});tool=settings.tool;syncSettings();
    if(persist) {
      if (onToolsChange) onToolsChange(settings);
      else window.dispatchEvent(new Event(INK_SETTINGS_EVENT));
    }
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
    if (!onToolsChange) {
      listen(window,INK_SETTINGS_EVENT,reload);
      listen(window,'storage',e=>{if(e.key===INK_SETTINGS_KEY)reload();});
    }
    syncSettings();
  }
  if(!readonly){
    const toggleEraser=()=>{resetInput();changeSettings({tool:tool==='eraser'?settings.lastDrawTool||'pen':'eraser'});};
    const penButton=box.querySelector('[data-ink="pen"]');let beforeDoubleClick=tool;if(penButton&&!answerPaper){listen(penButton,'click',e=>{if(e.detail===1)beforeDoubleClick=tool;},{capture:true});listen(penButton,'dblclick',e=>{e.preventDefault();resetInput();changeSettings({tool:beforeDoubleClick==='eraser'?settings.lastDrawTool||'pen':'eraser'});});}
    listen(viewport,'dblclick',e=>{if(e.pointerType==='pen'){e.preventDefault();toggleEraser();}});
    listen(viewport,'pointerdown',e=>{if(e.pointerType==='pen'&&(e.button===5||e.buttons===32))changeSettings({tool:'eraser'});},{capture:true});
    if(paper && !answerPaper) {
      box.querySelectorAll('[data-paper]').forEach(control=>{control.value=answer[control.dataset.paper]|| (control.dataset.paper==='background'?'none':'custom');listen(control,'change',()=>{if(isLocked())return;finish();begin();const key=control.dataset.paper,value=control.value;if(key==='pageSize'&&PAGE_SIZES[value]){const [w,h]=PAGE_SIZES[value];const outside=answer.strokes.some(s=>s.some(p=>p[0]<0||p[1]<0||p[0]>w||p[1]>h));if(outside){status.textContent='笔迹超出所选纸张，请先移动或缩小内容';control.value=answer.pageSize||'custom';transaction=null;return;}answer.width=w;answer.height=h;}answer[key]=value;view={zoom:1,x:0,y:0};commit();resize();});});
      const shape=box.querySelector('[data-shape]');
      shape.checked=shapeEnabled;
      listen(shape,'change',()=>{shapeEnabled=shape.checked;answer.shapeEnabled=shapeEnabled;clearTimeout(shapeTimer);onChange();});
    }
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(viewport);
  if (paper?.firstElementChild) observer?.observe(paper.firstElementChild);
  if (!observer) listen(window, 'resize', resize);
  if (inlineTiles) {
    const updateTiles = () => { viewDirty = true; requestWet(); };
    listen(viewport,'load',resize,{capture:true});
    listen(viewport,'toggle',resize,{capture:true});
    listen(window,'scroll',updateTiles,{passive:true});
    listen(window,'resize',updateTiles);
    if (window.visualViewport) {
      listen(window.visualViewport,'scroll',updateTiles);
      listen(window.visualViewport,'resize',updateTiles);
    }
  }
  resize(); updateControls();
  return {
    flush() { hidePencilHover(); stopGlide(); finish('flush'); },
    setPencilHoverDistance,
    selectTool,
    changeTools: changeSettings,
    undo: () => changeHistory(history, future),
    redo: () => changeHistory(future, history),
    setInlineView(next) { resetInput(); view = next; requestView(); },
    refreshInlineView() { if (inlineNavigation && !isLocked()) requestView(); },
    refresh: resize,
    hasActiveContact: () => pen !== null,
    setShapeEnabled(value) {
      finish(); clearTimeout(shapeTimer);
      if (shapeEnabled === value) return;
      shapeEnabled = answer.shapeEnabled = value;
      onChange();
    },
    paintInk(ctx) { paintAnswer(ctx, answer); },
    setExpanded,
    exportImage() { finish(); const canvas = renderAnswer(document.createElement('canvas'), answer, { background, backgroundHeight }); const data = canvas.toDataURL('image/png'); canvas.width = canvas.height = 1; return data; },
    dispose() { stopGlide(); finish(); disposed = true; for (const remove of listeners) remove(); clearTimeout(shapeTimer); observer?.disconnect(); cancelAnimationFrame(frame); if (previousOverflow !== null) document.body.style.overflow = previousOverflow; if (expanded) document.documentElement.classList.remove('ink-fullscreen'); inlineTiles?.clear(); for (const canvas of [dry, wet, highlight, wetHighlight].filter(Boolean)) canvas.width = canvas.height = 1; }
  };
}
