import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GOODNOTES_ENGINE,createGoodnotesSession,replayGoodnotesStroke,goodnotesOptions} from '../web/ink842/goodnotes-adapter.js';
import {renderAnswer} from '../web/ink842/ink-surface.js';
import {eraseCircle} from '../web/ink842/ink-geometry.js';
import {DEFAULT_INK_SETTINGS,strokeStyle,validInkStyle} from '../web/ink842/ink-settings.js';

// Record actual upstream canvas operations, including state restoration.
function canvas(){
 const calls=[],stack=[],state={globalAlpha:1};const c={width:1000,height:500,calls};
 const ctx=new Proxy({canvas:c},{get(target,key){
   if(key==='save')return()=>stack.push({...state});if(key==='restore')return()=>{const saved=stack.pop();for(const key of Object.keys(state))delete state[key];Object.assign(state,saved);};
   if(key in target)return target[key];if(key in state)return state[key];
   return(...args)=>calls.push([key,...args.map(a=>typeof a==='object'?'canvas':a),state.strokeStyle||state.fillStyle,state.lineWidth,state.globalAlpha]);
 },set(target,key,value){state[key]=value;return true;}});
 c.getContext=()=>ctx;return c;
}
const points=[[10,30,.2,0],[25,35,.4,8],[45,20,.8,16],[70,30,.5,24]];
const style={engine:GOODNOTES_ENGINE,kind:'pen',penType:'fountain',size:3.2,color:'#2563eb',pressure:true};
test('incremental GoodNotes writes and saved-sample replay produce identical engine operations',()=>{
 const main=canvas(),active=canvas(),session=createGoodnotesSession(main.getContext(),active.getContext(),style);
 session.feed(points.slice(0,1));session.feed(points.slice(0,3));session.feed(points);session.end(points);
 const restoredMain=canvas();replayGoodnotesStroke(restoredMain.getContext(),structuredClone(points),style);
 const geometry=calls=>calls.filter(c=>!['setTransform','clearRect','drawImage'].includes(c[0]));
 assert.deepEqual(geometry(active.calls),geometry(restoredMain.calls));
 assert.ok(active.calls.some(c=>c[0]==='ellipse'),'upstream fountain nib stamp must run');
 assert.ok(active.calls.some(c=>c[0]==='quadraticCurveTo'),'upstream incremental curve engine must run');
 assert.ok(main.calls.some(c=>c[0]==='drawImage'),'completed active bitmap must commit to the saved layer');
 for(const call of active.calls)for(const value of call)if(typeof value==='number')assert.ok(Number.isFinite(value));
});
test('partial erasing preserves pressure and interpolates the original sample time',()=>{
 const erased=eraseCircle([[[0,50,.2,0],[100,50,.8,100]]],[style],[50,50],10);
 assert.deepEqual(erased.strokes.map(s=>s.map(p=>p[3])),[[0,40],[60,100]]);
});

test('live commit draws only the current stroke directly without depending on a bitmap copy',()=>{
 const main=canvas(),active=canvas(),s=strokeStyle(DEFAULT_INK_SETTINGS),samples=[...points,[70,30,0,30]];
 const session=createGoodnotesSession(main.getContext(),active.getContext(),s,{commitByReplay:true});
 session.feed(samples.slice(0,-1));session.end(samples);
 const restored=canvas();replayGoodnotesStroke(restored.getContext(),samples,s);
 assert.deepEqual(main.calls,restored.calls);
 assert.ok(main.calls.some(c=>c[0]==='quadraticCurveTo'));
 assert.ok(!main.calls.some(c=>c[0]==='drawImage'||c[0]==='clearRect'));
});
test('mixed legacy/new image export uses GoodNotes without clearing earlier strokes',()=>{
 const main=canvas();
 renderAnswer(main,{height:500,strokes:[[[1,1,.5]],points],styles:[null,style]});
 assert.ok(main.calls.some(c=>c[0]==='ellipse'));
 assert.ok(main.calls.some(c=>c[0]==='stroke'));
 assert.equal(main.calls.filter(c=>c[0]==='clearRect').length,0);
 assert.equal(goodnotesOptions({...style,kind:'marker',size:24}).size*4.2,24);
 assert.equal(goodnotesOptions({...style,penType:'brush'}).penType,'brush');
});
test('default ink settings use the configured feel parameters and persist every adjustment',()=>{
 const s=strokeStyle(DEFAULT_INK_SETTINGS),o=goodnotesOptions(s);
 assert.equal(o.size,2);assert.equal(o.color,'#1c1917');
 assert.deepEqual([o.tipSharpness,o.pressureSensitivity,o.flatness,o.stabilization,o.rectification],[.8,.5,0,.9,1]);
 assert.deepEqual([o.pressureModel,o.pressureFloor,o.pressureCeiling,o.pressureGain],['logarithmic',.2,1,1.4]);
 s.feel.stabilization=.33;assert.equal(goodnotesOptions(s).stabilization,.33);assert.equal(validInkStyle(s),true);
 s.feel.flatness=2;assert.equal(validInkStyle(s),false);
});
test('CSS-coordinate calibration preserves upstream geometry and speed at different storage scales',()=>{
 const a=canvas(),b=canvas(),base={...strokeStyle(DEFAULT_INK_SETTINGS),inputScale:1};
 const samples=[...points, [70,30,0,30]];
 replayGoodnotesStroke(a.getContext(),samples,base);
 replayGoodnotesStroke(b.getContext(),samples.map(p=>[p[0]/2,p[1]/2,p[2],p[3]]),{...base,inputScale:2});
 const geometry=c=>c.calls.filter(x=>['ellipse','moveTo','lineTo','quadraticCurveTo','stroke','fill'].includes(x[0]));
 assert.deepEqual(geometry(a),geometry(b));
});
