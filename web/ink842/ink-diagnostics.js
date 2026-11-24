import { inlineContentAt } from './inline-ink-anchors.js';

// Diagnostic data is intentionally limited to event metadata. No pointer
// positions, paths, answer content, images or note identifiers leave the page.
export function createInkDiagnostics(now = () => performance.now()) {
  const started = now(), pending = [], lastSample = new Map();
  let sequence = 0, dropped = 0;
  return {
    add(kind, ...values) {
      const time = Math.round(now() - started);
      if (kind.endsWith('move') || ['view.geometry','view.viewport','view.anchor','render.tiles','render.context-unavailable'].includes(kind)) {
        const key = kind + ':' + (kind.endsWith('move') ? values[0] : '');
        if (time - (lastSample.get(key) ?? -Infinity) < 160) return;
        lastSample.set(key,time);
      }
      if (pending.length === 192) { pending.shift(); dropped++; }
      pending.push([++sequence,time,kind,...values]);
    },
    drain(flush = false) {
      if (!pending.length) return undefined;
      const batch = { events:pending.splice(0,flush ? pending.length : 48), dropped };
      dropped = 0;
      return batch;
    }
  };
}

export function observeInkInput(card, listen, report, isEditing) {
  let anchor, anchorNumber = 0, penContactId = null;
  const location = target => !target?.nodeType || !card.contains(target) ? 'outside' :
    target.closest?.('.cardlink-answer-ink-tools')
      ? target.closest?.('button,input,select,summary,label') ? 'toolbar-control' : 'toolbar-panel'
      : 'answer';
  const options = { capture:true, passive:true };
  function measureAnchor(kind = 'view.anchor') {
    if (!anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect(), root = card.getBoundingClientRect();
    report(kind,anchorNumber,anchor.tagName,Math.round(rect.left - root.left),Math.round(rect.top - root.top),
      Math.round(rect.width),Math.round(rect.height));
  }
  function selectAnchor(event, target = event.target) {
    if (location(target) !== 'answer') return;
    const next = inlineContentAt(card, { target, clientX: event.clientX, clientY: event.clientY },
      'img,canvas[data-drawing],figure,p,li,pre,table,h1,h2,h3,.text-block,.html-block') || card;
    if (anchor !== next) { anchor = next; anchorNumber++; measureAnchor('view.anchor-hit'); }
  }
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture']) {
    listen(window,type,event => {
      if (!isEditing()) { penContactId = null; return; }
      const source = ['pen','touch','mouse'].includes(event.pointerType) ? event.pointerType : 'unknown';
      const area = location(event.target);
      report('raw.' + type,source,event.pointerId,event.buttons,Number(event.pressure > 0),
        area,Number(event.cancelable),Number(event.isTrusted));
      if (source === 'pen') {
        if (type === 'pointerdown') penContactId = event.pointerId;
        else if (type === 'pointermove') {
          if (event.buttons || event.pressure) {
            if (penContactId !== event.pointerId) report('raw.pen-contact-without-down',event.pointerId,area);
            penContactId = event.pointerId;
          } else if (event.pointerId === penContactId) {
            penContactId = null;
          }
        } else if ((type === 'pointerup' || type === 'pointercancel') && event.pointerId === penContactId) penContactId = null;
      }
      if (type === 'pointerdown' && (source === 'pen' || source === 'mouse')) selectAnchor(event);
    }, options);
  }
  for (const type of ['touchstart','touchmove','touchend','touchcancel']) {
    listen(window,type,event => {
      if (!isEditing()) return;
      for (const contact of Array.from(event.changedTouches || []).slice(0,4)) {
        const source = contact.touchType === 'stylus' || contact.touchType === 'direct' ? contact.touchType : 'unknown';
        report('raw.' + type,source,contact.identifier,event.touches?.length ?? 0,
          location(contact.target || event.target),Number(event.cancelable),Number(event.isTrusted));
        if (type === 'touchstart' && source === 'stylus') selectAnchor(contact, contact.target || event.target);
      }
    }, options);
  }
  return measureAnchor;
}
