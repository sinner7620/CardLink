import {GoodNotesEngine} from '../vendor/goodnotes-ink/src/engine.ts';
import {GOODNOTES_GOLDEN_BASELINE_CONFIG,BALLPOINT_CONFIG,BRUSH_CONFIG,HIGHLIGHTER_CONFIG} from '../vendor/goodnotes-ink/src/constants.ts';

export const GOODNOTES_ENGINE = 'goodnotes-ink-v1';
export const isGoodnotesStyle=s=>['goodnotes-ink-v1','goodnotes-ink-v2'].includes(s?.engine);
export function goodnotesOptions(style) {
 // Earlier CardLink InkCanvas records stored the complete upstream pen options.
 // Preserve those settings when replaying/editing a pre-migration stroke.
 if(style.legacyOptions)return {...style.legacyOptions};
 const preset=style.kind==='marker'?HIGHLIGHTER_CONFIG:style.penType==='ballpoint'?BALLPOINT_CONFIG:style.penType==='brush'?BRUSH_CONFIG:GOODNOTES_GOLDEN_BASELINE_CONFIG;
 return {...preset,...(style.kind!=='marker'?style.feel||{}:{}),color:style.color||'#1c2933',size:style.kind==='marker'?style.size/4.2:style.size,
   pressureSensitivity:style.pressure?(style.feel?.pressureSensitivity??preset.pressureSensitivity):0,
   ...(style.line?{penType:'ballpoint',stabilization:0,flatness:0,tipSharpness:0}:{}),simulatePressure:false};
}
const point=(p,i,style)=>({x:p[0]*(style.inputScale||1),y:p[1]*(style.inputScale||1),pressure:style.pressure?p[2]:.5,time:p[3]??i*8});
export function clearGoodnotesLayer(ctx) {
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();
}
// Replay the original timestamped samples through the same incremental engine
// used during writing. Do not run upstream redrawAll's second smoothing pass.
export function createGoodnotesSession(mainCtx,activeCtx,style,{commitByReplay=false}={}) {
 const engine=new GoodNotesEngine(),options=goodnotesOptions(style);
 const sink={save(){},restore(){},setTransform(){},drawImage(){}};
 const context={mainCtx:commitByReplay?sink:mainCtx,activeCtx,width:1000,height:6000,dpr:1};
 let rendered=0;clearGoodnotesLayer(activeCtx);
 const inInputSpace=fn=>{activeCtx.save();if(style.inputScale)activeCtx.scale(1/style.inputScale,1/style.inputScale);try{fn()}finally{activeCtx.restore()}};
 return {
   feed(points){
     if(!points.length)return;
     inInputSpace(()=>{if(!rendered){engine.onPointerDown(point(points[0],0,style),options,context);rendered=1;}
     if(points.length>rendered){engine.onPointerMove(points.slice(rendered).map((p,i)=>point(p,rendered+i,style)),options,context);rendered=points.length;}});
   },
   end(points){this.feed(style.engine==='goodnotes-ink-v2'?points.slice(0,-1):points);if(points.length){const last=points.length-1;inInputSpace(()=>engine.onPointerUp(point(points[last],last,style),options,context));if(commitByReplay)replayGoodnotesStroke(mainCtx,points,style);}},
 };
}
export function replayGoodnotesStroke(mainCtx,points,style) {
 // Replay directly onto the history/export target. The upstream up handler
 // normally copies and clears its active layer; suppress only those layer
 // operations so previously replayed strokes cannot be cleared or aliased.
 const direct=new Proxy(mainCtx,{
   get(target,key){if(key==='clearRect')return()=>{};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},
   set(target,key,value){return Reflect.set(target,key,value,target);}
 });
 const sink={save(){},restore(){},setTransform(){},drawImage(){}};
 const session=createGoodnotesSession(sink,direct,style);session.end(points);
}
