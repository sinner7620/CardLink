import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useNativeTouch,dispatchTouches,touchPointer,penIsDown} from '../web/ink842/ink-input.js';
import {createInkSurface} from '../web/ink842/ink-surface.js';

function environment(ipad=true){
 const originals=new Map();const install=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value})};
 let box,now=0;const buttons=new Map(),settings=new Map(),colors=new Map();let transforms=[];
 class Element extends EventTarget{
  constructor(tag='div'){super();this.tagName=tag;this.style={};this.dataset={};this.children=[];this.captures=new Set();this.className='';this.textContent='';this.classes=new Set();this.classList={toggle:(name,force)=>{if(force)this.classes.add(name);else this.classes.delete(name)},remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name)};}
  append(...nodes){this.children.push(...nodes)}before(){}after(){}replaceWith(node){box.viewport=node}
  setAttribute(){}getAttribute(){return '手写答题区'}closest(){return null}
  getBoundingClientRect(){return {left:0,top:0,width:1000,height:box.classes.has('ink-expanded')?900:Number.parseFloat(this.style.height)||500}}
  setPointerCapture(id){this.captures.add(id)}hasPointerCapture(id){return this.captures.has(id)}releasePointerCapture(id){this.captures.delete(id)}
  getContext(){
   if(this.context)return this.context;let current=[1,0,0,1,0,0];const stack=[];
   this.context=new Proxy({canvas:this},{get:(target,key)=>key==='setTransform'?(...values)=>{current=values;transforms.push(values)}:key==='save'?()=>stack.push([...current]):key==='restore'?()=>{current=stack.pop()||current;transforms.push(current)}:['fill','stroke'].includes(key)?()=>{this.draws=(this.draws||0)+1}:target[key]||(()=>{}),set:(target,key,value)=>{target[key]=value;return true}});return this.context;
  }
  insertAdjacentHTML(position,html){for(const match of html.matchAll(/data-ink="([^"]+)"/g)){if(!buttons.has(match[1])){const b=new Element('button');b.dataset.ink=match[1];buttons.set(match[1],b)}}
   for(const match of html.matchAll(/data-ink-setting="([^"]+)"/g)){const b=new Element('select');b.dataset.inkSetting=match[1];settings.set(match[1],b)}
   for(const match of html.matchAll(/data-ink-color="([^"]+)"/g)){const b=new Element('button');b.dataset.inkColor=match[1];colors.set(match[1],b)}
  }
 }
 box=new Element();const placeholder=new Element('canvas'),tools=new Element();
 for(const name of ['pen','eraser','undo','redo','grow','full']){const b=new Element('button');b.dataset.ink=name;buttons.set(name,b)}
 box.querySelector=selector=>selector==='canvas'?placeholder:selector==='.ink-tools'?tools:buttons.get(selector.match(/data-ink="([^"]+)"/)?.[1])||null;
 box.querySelectorAll=selector=>['[data-ink-for]','[data-ink-value]'].includes(selector)?[]:selector==='[data-ink-setting]'?[...settings.values()]:selector==='[data-ink-color]'?[...colors.values()]:selector==='[data-ink]'?[...buttons.values()]:[buttons.get('pen'),buttons.get('eraser')];
 const doc=new Element();doc.body=new Element();doc.documentElement=new Element();doc.createElement=tag=>new Element(tag);doc.hidden=false;
 const win=new Element();win.devicePixelRatio=2;win.ontouchstart=null;win.getSelection=()=>({removeAllRanges(){}});win.scrollBy=()=>{};
 install('document',doc);install('window',win);install('navigator',ipad?{maxTouchPoints:5,userAgent:'iPad Safari',platform:'MacIntel'}:{maxTouchPoints:0,userAgent:'Chrome',platform:'Win32'});
 install('ResizeObserver',class{observe(){}disconnect(){}});install('requestAnimationFrame',()=>1);install('cancelAnimationFrame',()=>{});
 install('performance',{now:()=>now});
 const stored=new Map();install('localStorage',{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)});
 return {box,buttons,settings,colors,win,transforms,advance(ms){now+=ms},restore(){for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}};
}
function event(target,type,props={}){const e=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(props))Object.defineProperty(e,key,{value});target.dispatchEvent(e);return e}
const pencil=(id,x,y)=>({identifier:id,touchType:'stylus',force:.5,clientX:x,clientY:y});
const finger=(id,x,y)=>({identifier:id,touchType:'direct',radiusX:8,radiusY:8,clientX:x,clientY:y});
test('tool preferences persist, new strokes keep independent styles, and line/undo preserve metadata',()=>{
 const env=environment(false),answer={height:500,text:'',strokes:[]};let surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const pen=(x,y)=>({pointerId:1,pointerType:'pen',clientX:x,clientY:y,button:0,buttons:1,pressure:.5});
 const draw=()=>{event(v,'pointerdown',pen(100,100));event(v,'pointermove',pen(140,180));event(v,'pointerup',{...pen(200,150),buttons:0,pressure:0})};
 try{
  event(env.colors.get('#2563eb'),'click');env.settings.get('size').value='7';event(env.settings.get('size'),'change');draw();
  assert.equal(answer.styles[0].color,'#2563eb');assert.equal(answer.styles[0].size,7);
  event(env.buttons.get('marker'),'click');env.settings.get('markerSize').value='32';event(env.settings.get('markerSize'),'change');draw();
  assert.equal(answer.styles[1].kind,'marker');assert.equal(answer.styles[1].size,32);assert.equal(answer.styles[0].size,7);
  event(env.buttons.get('undo'),'click');assert.equal(answer.styles.length,1);event(env.buttons.get('redo'),'click');assert.equal(answer.styles[1].kind,'marker');
  surface.dispose();surface=createInkSurface(env.box,answer);v=env.box.viewport;
  assert.equal(env.settings.get('markerSize').value,'32');draw();assert.equal(answer.styles.at(-1).kind,'marker');
  event(env.buttons.get('line'),'click');draw();assert.equal(answer.strokes.at(-1).length,2);assert.equal(answer.styles.at(-1).color,'#2563eb');
 }finally{surface.dispose();env.restore()}
});

test('iPad touch routing keeps Pencil separate and cancels native browser gestures',()=>{
 assert.equal(useNativeTouch({maxTouchPoints:5,platform:'MacIntel'},true),true);
 const calls=[];let prevented=false;dispatchTouches({type:'touchstart',cancelable:true,preventDefault(){prevented=true},changedTouches:[pencil(3,20,30),finger(4,40,50)]},{down:e=>calls.push(e)});
 assert.equal(prevented,true);assert.deepEqual(calls.map(c=>c.pointerType),['pen','touch']);
 assert.equal(touchPointer(pencil(3,20,30),{type:'touchend'},true).buttons,0);
 assert.equal(penIsDown({pointerType:'pen',buttons:0,pressure:0}),false);
});

test('actual surface handles rapid Pencil strokes, immediate pinch and fullscreen bottom',()=>{
 const env=environment();const answer={height:500,text:'',strokes:[]};let changes=0;
 const surface=createInkSurface(env.box,answer,{onChange(){changes++}});const v=env.box.viewport;
 try{
  event(env.buttons.get('full'),'click');assert.equal(answer.height,900,'all visible white paper must be writable');
  for(let i=0;i<20;i++){
   const down=event(v,'touchstart',{changedTouches:[pencil(i,100,820)]});assert.equal(down.defaultPrevented,true);
   event(v,'touchmove',{changedTouches:[pencil(i,140,860)]});event(v,'touchend',{changedTouches:[pencil(i,150,870)]});
  }
  assert.equal(answer.strokes.length,20);assert.equal(answer.strokes[0].at(-1)[1],870);
  event(v,'pointermove',{pointerType:'pen',pointerId:99,buttons:0,pressure:0});
  event(v,'touchstart',{changedTouches:[finger(100,200,200),finger(101,400,200)]});
  event(v,'touchmove',{changedTouches:[finger(101,600,200)]});
  assert.equal(env.buttons.get('zoom-reset').textContent,'200%','Pencil hover or recent pen-up must not block pinch');
  event(v,'touchend',{changedTouches:[finger(100,200,200),finger(101,600,200)]});
  const before=env.transforms.at(-1)[5];event(v,'touchstart',{changedTouches:[finger(102,500,500)]});event(v,'touchmove',{changedTouches:[finger(102,500,400)]});
  assert.ok(env.transforms.at(-1)[5]<before,'single finger pans in fullscreen');
  assert.ok(changes>=20);
 }finally{surface.dispose();env.restore()}
});

test('cancelled contacts and missing pointer-up recover without losing later strokes',()=>{
 const env=environment(false),answer={height:500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const pen=(pointerId,x)=>({pointerType:'pen',pointerId,clientX:x,clientY:100,button:0,buttons:1,pressure:.5});
 try{
  v.setPointerCapture=()=>{throw Error('capture not available')};
  event(v,'pointerdown',pen(1,100));event(v,'pointermove',pen(1,120));
  event(env.win,'pointerup',{...pen(1,130),buttons:0,pressure:0});assert.equal(answer.strokes.length,1);
  event(v,'pointermove',pen(2,150));event(v,'pointercancel',pen(2,160));assert.equal(answer.strokes.length,2);
  event(v,'pointerdown',pen(3,170));event(v,'pointerdown',pen(4,180));event(env.win,'pointerup',{...pen(4,190),buttons:0,pressure:0});
  assert.equal(answer.strokes.length,4,'fresh pen-down replaces a stale contact');
 }finally{surface.dispose();env.restore()}
});
test('modern iPad pointers retain Pencil identity and pinch transitions back to single-finger pan',()=>{
 const env=environment();env.win.PointerEvent=class{};
 const answer={height:1500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const pointer=(id,type,x,y)=>({pointerId:id,pointerType:type,clientX:x,clientY:y,button:0,buttons:1,pressure:.5});
 try{
  event(v,'pointerdown',pointer(1,'pen',100,100));event(v,'pointerup',{...pointer(1,'pen',120,120),buttons:0,pressure:0});
  assert.equal(answer.strokes.length,1);
  event(v,'pointerdown',pointer(2,'touch',200,200));event(v,'pointerdown',pointer(3,'touch',400,200));
  event(v,'pointermove',pointer(3,'touch',600,200));assert.equal(env.buttons.get('zoom-reset').textContent,'200%');
  event(v,'pointerup',pointer(3,'touch',600,200));const before=env.transforms.at(-1)[5];
  event(v,'pointermove',pointer(2,'touch',200,100));assert.ok(env.transforms.at(-1)[5]<before);
 }finally{surface.dispose();env.restore()}
});
test('Pencil scribble erases existing ink as one undoable action',()=>{
 const env=environment();env.win.PointerEvent=class{};
 const original=[[[90,120,.5],[190,120,.5]]];
 const answer={height:500,text:'',strokes:structuredClone(original)};
 const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const pen=(x,y)=>({pointerId:1,pointerType:'pen',clientX:x,clientY:y,button:0,buttons:1,pressure:.5});
 try{
  event(v,'pointerdown',pen(100,100));
  for(let i=1;i<9;i++)event(v,'pointermove',pen(i%2?180:100,100+i*5));
  event(v,'pointerup',{...pen(100,140),buttons:0,pressure:0});
  assert.notDeepEqual(answer.strokes,original);
  assert.ok(answer.strokes.every(s=>s.length<7),'scribble gesture itself must not remain as ink');
  event(env.buttons.get('undo'),'click');assert.deepEqual(answer.strokes,original);
 }finally{surface.dispose();env.restore()}
});
test('iPad Touch fallback works with PointerEvent present and deduplicates Pencil streams',()=>{
 const env=environment();env.win.PointerEvent=class{};
 const answer={height:1500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const p=(type,x)=>({pointerId:7,pointerType:'pen',clientX:x,clientY:100,button:0,buttons:1,pressure:.5});
 const touch=(type,changed,touches)=>event(v,type,{changedTouches:changed,touches});
 try{
  event(v,'pointerdown',p('pen',100));touch('touchstart',[pencil(70,100,100)],[pencil(70,100,100)]);
  event(v,'pointercancel',{...p('pen',110),buttons:0,pressure:0});
  touch('touchmove',[pencil(70,140,100)],[pencil(70,140,100)]);
  event(env.win,'touchend',{changedTouches:[pencil(70,150,100)],touches:[]});
  assert.equal(answer.strokes.length,1,'one physical Pencil contact creates exactly one stroke');
  assert.equal(answer.strokes[0].at(-1)[0],150);
  // Next contact omits PointerEvents altogether despite the API being available.
  touch('touchstart',[pencil(71,200,100)],[pencil(71,200,100)]);
  touch('touchmove',[pencil(71,220,100)],[pencil(71,220,100)]);touch('touchend',[pencil(71,230,100)],[]);
  assert.equal(answer.strokes.length,2);
  const a={...finger(80,200,200),radiusX:45,radiusY:45},b=finger(81,400,200);
  touch('touchstart',[a,b],[a,b]);touch('touchmove',[finger(81,600,200)],[a,finger(81,600,200)]);
  assert.equal(env.buttons.get('zoom-reset').textContent,'200%','wide finger contacts must not be discarded as palms after pen-up');
 }finally{surface.dispose();env.restore()}
});
test('missing native pen-up is reconciled before the following finger gesture',()=>{
 const env=environment();env.win.PointerEvent=class{};
 const answer={height:1500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const native=(type,changed,touches)=>event(v,type,{changedTouches:changed,touches});
 try{
  native('touchstart',[pencil(1,100,100)],[pencil(1,100,100)]);
  native('touchmove',[pencil(1,120,120)],[pencil(1,120,120)]);
  // Safari drops the up. Its next complete TouchList excludes that Pencil.
  const a=finger(2,200,200),b=finger(3,400,200);
  // Pointer finger-down arrives first and is rejected while the stale Pencil
  // is still latched. Native adoption must try that contact again after cleanup.
  event(v,'pointerdown',{pointerId:20,pointerType:'touch',clientX:200,clientY:200});
  event(v,'pointerdown',{pointerId:30,pointerType:'touch',clientX:400,clientY:200});
  native('touchstart',[a,b],[a,b]);assert.equal(answer.strokes.length,1);
  native('touchmove',[finger(3,600,200)],[a,finger(3,600,200)]);
  assert.equal(env.buttons.get('zoom-reset').textContent,'200%');
  event(env.win,'blur');
  native('touchstart',[pencil(4,300,100)],[pencil(4,300,100)]);native('touchend',[pencil(4,310,110)],[]);
  assert.equal(answer.strokes.length,2,'backgrounding resets stale fingers and pen state');
 }finally{surface.dispose();env.restore()}
});
test('single finger pans even when the full paper initially fits the viewport',()=>{
 const env=environment(false),answer={height:500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 try{
  const touch=(x,y)=>({pointerId:2,pointerType:'touch',clientX:x,clientY:y,width:90,height:90});
  event(v,'pointerdown',touch(300,200));const before=env.transforms.at(-1)[5];event(v,'pointermove',touch(300,150));
  assert.ok(env.transforms.at(-1)[5]<before,'paper should visibly follow a drag at 100%');
  assert.equal(answer.strokes.length,0);
 }finally{surface.dispose();env.restore()}
});
test('a stalled pointer-only Pencil cannot permanently block fingers or the next stroke',()=>{
 const env=environment(),answer={height:1500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const pen=(id,x)=>({pointerId:id,pointerType:'pen',clientX:x,clientY:100,buttons:1,pressure:.5});
 try{
  event(v,'pointerdown',pen(1,100));event(v,'pointermove',pen(1,120));
  env.advance(200);
  event(v,'touchstart',{changedTouches:[finger(2,300,200)],touches:[finger(2,300,200)]});
  assert.equal(answer.strokes.length,1);
  const before=env.transforms.at(-1)[5];event(v,'touchmove',{changedTouches:[finger(2,300,150)],touches:[finger(2,300,150)]});
  assert.ok(env.transforms.at(-1)[5]<before);
  event(v,'touchend',{changedTouches:[finger(2,300,150)],touches:[]});
  event(v,'pointerdown',pen(3,200));event(v,'pointerup',{...pen(3,220),buttons:0,pressure:0});
  assert.equal(answer.strokes.length,2);
 }finally{surface.dispose();env.restore()}
});
test('ink paints before RAF, keeps low hardware pressure, and the eraser returns to the prior pen',()=>{
 const env=environment(),answer={height:500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const p=(id,x)=>({pointerId:id,pointerType:'pen',clientX:x,clientY:100,buttons:1,pressure:.02,timeStamp:env.now});
 try{
  event(v,'pointerdown',p(1,100));assert.ok(v.children[1].draws>0,'pen-down paints synchronously while RAF never executes');
  event(v,'pointermove',{...p(1,150),getCoalescedEvents:()=>[{...p(1,110),timeStamp:2},{...p(1,130),timeStamp:4},{...p(1,150),timeStamp:6}]});
  event(v,'pointerup',{...p(1,160),pressure:0,buttons:0,timeStamp:8});
  assert.equal(answer.strokes[0][0][2],.02);assert.equal(answer.strokes[0].at(-1)[2],0);
  assert.equal(answer.styles[0].feel.stabilization,1.2);assert.equal(answer.styles[0].inputScale,1);
  event(env.buttons.get('marker'),'click');event(env.buttons.get('eraser'),'click');
  event(v,'pointerdown',p(2,100));event(v,'pointerup',{...p(2,110),pressure:0,buttons:0});
  event(v,'pointerdown',p(3,300));event(v,'pointerup',{...p(3,320),pressure:0,buttons:0});
  assert.equal(answer.styles.at(-1).kind,'marker','one erase returns to the previously selected highlighter');
 }finally{surface.dispose();env.restore()}
});
test('native Touch no longer discards timely coalesced Pencil samples',()=>{
 const env=environment(),answer={height:500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const p=(x,t)=>({pointerId:1,pointerType:'pen',clientX:x,clientY:100,buttons:1,pressure:.069,timeStamp:t});
 try{
  event(v,'pointerdown',p(100,0));event(v,'touchstart',{changedTouches:[pencil(7,100,100)],touches:[pencil(7,100,100)]});
  event(v,'pointermove',{...p(140,8),getCoalescedEvents:()=>[p(110,2),p(120,4),p(130,6),p(140,8)]});
  event(v,'touchmove',{changedTouches:[pencil(7,140,100)],touches:[pencil(7,140,100)],timeStamp:8});
  event(v,'pointerup',{...p(150,10),pressure:0,buttons:0});event(v,'touchend',{changedTouches:[pencil(7,150,100)],touches:[],timeStamp:10});
  assert.equal(answer.strokes.length,1);assert.equal(answer.strokes[0].length,6);
  assert.deepEqual(answer.strokes[0].slice(0,5).map(p=>p[0]),[100,110,120,130,140]);
 }finally{surface.dispose();env.restore()}
});

test('whole-stroke eraser removes the touched stroke and undo restores it',()=>{
 const env=environment(false),original=[[[100,100,.5],[300,100,.5]],[[100,300,.5],[300,300,.5]]];
 const answer={height:500,text:'',strokes:structuredClone(original)};
 const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 try{
  env.settings.get('eraserMode').value='stroke';event(env.settings.get('eraserMode'),'change');
  event(env.buttons.get('eraser'),'click');
  event(v,'pointerdown',{pointerId:1,pointerType:'pen',clientX:200,clientY:100,buttons:1,pressure:.5});
  event(v,'pointerup',{pointerId:1,pointerType:'pen',clientX:200,clientY:100,buttons:0,pressure:0});
  assert.deepEqual(answer.strokes,[original[1]]);
  event(env.buttons.get('undo'),'click');assert.deepEqual(answer.strokes,original);
 }finally{surface.dispose();env.restore()}
});

test('resizing an editor viewport preserves paper height and existing stroke data',()=>{
 const env=environment(false),answer={height:250,text:'',strokes:[[[40,50,.5],[80,90,.5]]],styles:[null]};
 const before=JSON.stringify(answer);let changes=0;
 const surface=createInkSurface(env.box,answer,{fullWindow:true,extendToViewport:false,onChange(){changes++}});
 try{
  event(env.buttons.get('full'),'click');
  assert.equal(JSON.stringify(answer),before);assert.equal(changes,0);
  event(env.buttons.get('grow'),'click');assert.equal(answer.height,750);assert.equal(changes,1);
 }finally{surface.dispose();env.restore()}
});

test('fresh Pencil downs with reused Pointer and Touch IDs replace an unclosed paired contact',()=>{
 const env=environment(),answer={height:1500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 const p=(x)=>({pointerId:1,pointerType:'pen',clientX:x,clientY:100,buttons:1,pressure:.5});
 try{
  for(let i=0;i<30;i++){
   event(v,'pointerdown',p(100));
   event(v,'touchstart',{changedTouches:[pencil(7,100,100)],touches:[pencil(7,100,100)]});
   event(v,'pointermove',p(120));
   event(v,'pointerup',{...p(130),buttons:0,pressure:0});
   // Missing touchend: the next physical stroke reuses both IDs. The fresh
   // pointerdown must commit the previous stroke before accepting this one.
   if(i)assert.equal(answer.strokes.length,i);
  }
  surface.flush();assert.equal(answer.strokes.length,30);
 }finally{surface.dispose();env.restore()}
});

test('a reused native stylus ID starts another stroke even when no end event was delivered',()=>{
 const env=environment(),answer={height:1500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 try{
  for(let i=0;i<20;i++){
   event(v,'touchstart',{changedTouches:[pencil(1,100,100)],touches:[pencil(1,100,100)]});
   event(v,'touchmove',{changedTouches:[pencil(1,120,100)],touches:[pencil(1,120,100)]});
   if(i)assert.equal(answer.strokes.length,i);
  }
  event(v,'touchend',{changedTouches:[pencil(1,130,100)],touches:[]});
  assert.equal(answer.strokes.length,20);
 }finally{surface.dispose();env.restore()}
});

test('alternating Touch-first and Pointer-first contacts recover missing ends with changing pointer IDs',()=>{
 const env=environment(),answer={height:1500,text:'',strokes:[]};const surface=createInkSurface(env.box,answer),v=env.box.viewport;
 try{
  for(let i=0;i<50;i++){
   const p={pointerId:100+i,pointerType:'pen',clientX:100,clientY:100,buttons:1,pressure:.5};
   const native=()=>event(v,'touchstart',{changedTouches:[pencil(i%2,100,100)],touches:[pencil(i%2,100,100)]});
   if(i%2){native();event(v,'pointerdown',p);}else{event(v,'pointerdown',p);native();}
   event(v,'pointermove',{...p,clientX:120});
   if(i%3)event(v,'pointerup',{...p,clientX:130,buttons:0,pressure:0});
   if(i)assert.equal(answer.strokes.length,i);
  }
  event(v,'touchend',{changedTouches:[pencil(1,130,100)],touches:[]});
  assert.equal(answer.strokes.length,50);
  event(env.buttons.get('undo'),'click');assert.equal(answer.strokes.length,49);
 }finally{surface.dispose();env.restore()}
});
