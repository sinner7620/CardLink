// iPadOS provides Pencil classification on native Touch objects. Handling those
// directly also lets us cancel Safari selection/scrolling before it steals ink.
export function useNativeTouch(nav, supported) {
  return supported && nav.maxTouchPoints > 0 && (/iPad|iPhone|iPod/.test(nav.userAgent || '') || nav.platform === 'MacIntel');
}

export function touchPointer(touch, event, ended = false) {
  return {
    inkTouch: true, pointerId: `touch:${touch.identifier}`,
    pointerType: touch.touchType === 'stylus' ? 'pen' : 'touch',
    clientX: touch.clientX, clientY: touch.clientY,
    pressure: ended ? 0 : Number.isFinite(touch.force)?touch.force:.5, button: 0, buttons: ended ? 0 : 1,
    timeStamp:event.timeStamp,
    width: (touch.radiusX || 0) * 2, height: (touch.radiusY || 0) * 2,
    type: ended ? event.type === 'touchcancel' ? 'pointercancel' : 'pointerup' : event.type === 'touchstart' ? 'pointerdown' : 'pointermove',
    preventDefault: () => { if (event.cancelable) event.preventDefault(); }
  };
}

export function dispatchTouches(event, callbacks) {
  if (event.cancelable) event.preventDefault();
  const ended = event.type === 'touchend' || event.type === 'touchcancel';
  const handler = ended ? callbacks.end : event.type === 'touchstart' ? callbacks.down : callbacks.move;
  for (const touch of Array.from(event.changedTouches || [])) handler(touchPointer(touch, event, ended));
}

export function penIsDown(event) {
  return event.pointerType === 'pen' && (event.buttons > 0 || event.pressure > 0);
}

// Reconcile the two event streams by physical contact, rather than selecting
// one API for the entire iPad. Touch tracks contact lifetime while timely
// Pointer samples retain their higher-frequency coalesced input.
export function createInkInputRouter(callbacks, report, { finishPenOnPointerUp = false } = {}) {
  const pointers=new Map(), touches=new Map();
  const completedPenTouches=new Set();
  const entries=()=>new Set([...pointers.values(),...touches.values()]);
  const remove=entry=>{if(entry.pointerId!==undefined)pointers.delete(entry.pointerId);if(entry.touchId!==undefined)touches.delete(entry.touchId);};
  const end=(entry,event,reason=event.type)=>{
    report?.('route.end',entry.type,entry.id,reason);
    remove(entry);callbacks.end({type:event.type,pointerId:entry.id,pointerType:entry.type,timeStamp:event.timeStamp,inkTouch:!!event.inkTouch,clientX:event.clientX??entry.x,clientY:event.clientY??entry.y,pressure:0,buttons:0});
  };
  const match=(type,x,y)=>[...entries()].find(c=>c.type===type&&Math.hypot(c.x-x,c.y-y)<24);
  const canonical=(event,entry)=>event.pointerId===entry.id?event:{type:event.type,pointerId:entry.id,pointerType:event.pointerType,clientX:event.clientX,clientY:event.clientY,pressure:event.pressure,buttons:event.buttons,button:event.button,width:event.width,height:event.height,timeStamp:event.timeStamp,preventDefault:()=>event.preventDefault(),getCoalescedEvents:()=>event.getCoalescedEvents?.()||[]};
  function pointer(event) {
    const ending=['pointerup','pointercancel','lostpointercapture'].includes(event.type);
    let entry=pointers.get(event.pointerId);
    // A new down is a new physical contact, even when the previous contact
    // still has a Touch association whose end never reached the WebView.
    if(event.type==='pointerdown'&&entry){end(entry,{type:'pointercancel'},'reused-pointer-id');entry=null;}
    if(entry?.touchId!==undefined){
      // As in 842practice, a real Pointer up is enough to commit the stroke.
      // A cancelled pointer can still have a live native Touch stream.
      if(finishPenOnPointerUp&&entry.type==='pen'&&event.type==='pointerup'){
        completedPenTouches.add(entry.touchId);
        end(entry,event);
        return;
      }
      if (ending) {
        entry.lastPointer = -Infinity;
        if (entry.pointerEnd !== 'pointerup') entry.pointerEnd = event.type;
        report?.('route.await-touch-end',entry.type,entry.id,event.type);
      }
      if(event.pointerType==='pen'&&event.type==='pointermove'&&penIsDown(event)){
        entry.pointerEnd=undefined;
        entry.lastPointer=performance.now();entry.x=event.clientX;entry.y=event.clientY;callbacks.move(canonical(event,entry));
      }
      return;
    }
    if(ending){if(entry)end(entry,event);return;}
    if(!entry){
      if(event.type!=='pointerdown'&&!penIsDown(event))return;
      entry=match(event.pointerType,event.clientX,event.clientY);
      if (entry?.touchId !== undefined && entry.pointerId !== undefined) {
        const interrupted = entry.pointerEnd === 'pointercancel' || entry.pointerEnd === 'lostpointercapture';
        // A new pressed Pointer may arrive without down after the old up was missed.
        // Resume a paired Touch only when the previous Pencil Pointer was interrupted.
        if (event.type === 'pointerdown' || (event.pointerType === 'pen' && !interrupted)) {
          end(entry, {type:'pointercancel'}, 'new-pointer-paired-touch');
          entry = null;
        }
      }
      if (entry?.touchId !== undefined) {
        if (entry.pointerId !== undefined) pointers.delete(entry.pointerId);
        entry.pointerId = event.pointerId;
        entry.pointerEnd = undefined;
        pointers.set(event.pointerId,entry);
        report?.('route.pair',entry.type,entry.id,event.pointerId,entry.touchId);
        if (event.type === 'pointermove' && penIsDown(event)) {
          entry.lastPointer = performance.now();
          entry.x = event.clientX; entry.y = event.clientY;
          callbacks.move(canonical(event,entry));
        }
        return;
      }
      entry={id:event.pointerId,pointerId:event.pointerId,type:event.pointerType,x:event.clientX,y:event.clientY,lastPointer:performance.now()};pointers.set(event.pointerId,entry);
      report?.('route.down',entry.type,entry.id,event.type);
      callbacks.down(event);
      if(event.type==='pointerdown')return;
    }
    entry.x=event.clientX;entry.y=event.clientY;
    entry.lastPointer=performance.now();
    callbacks.move(event);
  }
  function touch(event, startAllowed=true, penOnly=false, fingerOnly=false) {
    if(!startAllowed&&!touches.size&&!completedPenTouches.size)return;
    const ending=event.type==='touchend'||event.type==='touchcancel';
    const changedTouches = Array.from(event.changedTouches || []).filter(t => {
      if (!penOnly && !fingerOnly) return true;
      const isPen = t.touchType === 'stylus' || touches.get(t.identifier)?.type === 'pen' ||
        (t.touchType !== 'direct' && match('pen', t.clientX, t.clientY));
      return penOnly ? isPen : !isPen;
    });
    if(startAllowed&&event.cancelable&&changedTouches.length)event.preventDefault();
    // A complete TouchList repairs omitted end/cancel events before new gestures.
    if(event.touches!==undefined){
      const live=new Set(Array.from(event.touches,t=>t.identifier));
      const changed=new Set(changedTouches.map(t=>t.identifier));
      for(const id of completedPenTouches)if(!live.has(id)&&!changed.has(id))completedPenTouches.delete(id);
      for(const [id,entry]of touches)if(!live.has(id)&&!(ending&&changed.has(id)))end(entry,{type:'pointercancel',clientX:entry.x,clientY:entry.y,pressure:0,buttons:0},'missing-from-touch-list');
    }
    for(const t of changedTouches){
      if(completedPenTouches.has(t.identifier)){
        if(ending||event.type==='touchstart')completedPenTouches.delete(t.identifier);
        if(event.type!=='touchstart')continue;
      }
      let entry=touches.get(t.identifier);
      if(ending){if(entry)end(entry,touchPointer(t,event,true));continue;}
      if(event.type==='touchstart'&&entry){end(entry,{type:'pointercancel'},'reused-touch-id');entry=null;}
      if(!entry){
        if(!startAllowed)continue;
        const knownPen=t.touchType!=='direct'&&match('pen',t.clientX,t.clientY);
        const type=t.touchType==='stylus'||knownPen?'pen':'touch';
        entry=match(type,t.clientX,t.clientY);
        if(entry?.touchId!==undefined)entry=null;
        if(entry){entry.touchId=t.identifier;touches.set(t.identifier,entry);report?.('route.pair',entry.type,entry.id,entry.pointerId,t.identifier);if(type==='touch')callbacks.down({...touchPointer(t,event),pointerId:entry.id,pointerType:type});}
        else{entry={id:`touch:${t.identifier}`,touchId:t.identifier,type,x:t.clientX,y:t.clientY};touches.set(t.identifier,entry);report?.('route.down',entry.type,entry.id,event.type);callbacks.down({...touchPointer(t,event),pointerId:entry.id,pointerType:type});}
      }
      entry.x=t.clientX;entry.y=t.clientY;
      if(event.type==='touchmove'&&!(entry.type==='pen'&&entry.pointerId!==undefined&&performance.now()-(entry.lastPointer??-Infinity)<32))callbacks.move({...touchPointer(t,event),pointerId:entry.id,pointerType:entry.type});
    }
  }
  return {pointer,touch,hasNativePen:()=>[...touches.values()].some(c=>c.type==='pen'),reset(){for(const entry of entries())end(entry,{type:'pointercancel',pressure:0,buttons:0},'input-reset');pointers.clear();touches.clear();completedPenTouches.clear();}};
}
