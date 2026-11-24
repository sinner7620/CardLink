// Erase a swept disk (capsule), rather than resampling it into hundreds of
// circles. Immutable stroke identities keep the spatial index and bounds cheap.
const rawCache=new WeakMap();
const EPS=1e-9;
export const overlaps=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
export function unionBounds(a,b){return !a?{...b}:{minX:Math.min(a.minX,b.minX),minY:Math.min(a.minY,b.minY),maxX:Math.max(a.maxX,b.maxX),maxY:Math.max(a.maxY,b.maxY)};}
const expand=(b,r)=>({minX:b.minX-r,minY:b.minY-r,maxX:b.maxX+r,maxY:b.maxY+r});
const segmentBounds=(a,b)=>({minX:Math.min(a[0],b[0]),minY:Math.min(a[1],b[1]),maxX:Math.max(a[0],b[0]),maxY:Math.max(a[1],b[1])});
export function strokeBounds(stroke,style,visual=false){
 let b=rawCache.get(stroke);
 if(!b){b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};for(const p of stroke){b.minX=Math.min(b.minX,p[0]);b.minY=Math.min(b.minY,p[1]);b.maxX=Math.max(b.maxX,p[0]);b.maxY=Math.max(b.maxY,p[1]);}rawCache.set(stroke,b);}
 // Conservative nib padding also covers pressure gain, old styles and zoom-at-input.
 return visual?expand(b,style?Math.max(8,(style.size*(4+(style.feel?.pressureGain||1.8)*(style.feel?.pressureCeiling||1))+8)/(style.inputScale||1)):8):b;
}
export function createStrokeIndex(strokes=[],styles=[]){
 const cells=new Map(),records=new Map(),wide=new Set();let source=null,count=0;
 const keys=b=>{const x0=Math.floor(b.minX/96),x1=Math.floor(b.maxX/96),y0=Math.floor(b.minY/96),y1=Math.floor(b.maxY/96);if((x1-x0+1)*(y1-y0+1)>256)return null;const out=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)out.push(`${x},${y}`);return out;};
 const api={
  add(stroke,style){if(records.has(stroke)||!stroke.length)return;const bounds=strokeBounds(stroke,style,true),k=keys(bounds);records.set(stroke,{bounds,keys:k});if(!k)wide.add(stroke);else for(const key of k){if(!cells.has(key))cells.set(key,new Set());cells.get(key).add(stroke);}},
  remove(stroke){const rec=records.get(stroke);if(!rec)return;if(!rec.keys)wide.delete(stroke);else for(const key of rec.keys){const c=cells.get(key);c.delete(stroke);if(!c.size)cells.delete(key);}records.delete(stroke);},
  query(bounds){const found=new Set(),k=keys(bounds);if(!k){for(const [s,r]of records)if(overlaps(bounds,r.bounds))found.add(s);return found;}for(const key of k)for(const s of cells.get(key)||[])if(overlaps(bounds,records.get(s).bounds))found.add(s);for(const s of wide)if(overlaps(bounds,records.get(s).bounds))found.add(s);return found;},
  bounds(stroke){return records.get(stroke)?.bounds;},
  track(next){source=next;count=next.length;},
  sync(next,nextStyles){if(next===source&&count===next.length)return;cells.clear();records.clear();wide.clear();next.forEach((s,i)=>api.add(s,nextStyles[i]));api.track(next);},
 };
 api.sync(strokes,styles);return api;
}
const interpolate=(a,b,t)=>t===0?a:t===1?b:a.map((v,i)=>v+(b[i]-v)*t);
function circleInterval(a,b,c,r){
 const dx=b[0]-a[0],dy=b[1]-a[1],x=a[0]-c[0],y=a[1]-c[1],A=dx*dx+dy*dy;
 if(A<EPS)return x*x+y*y<r*r?[0,1]:null;
 const B=2*(x*dx+y*dy),C=x*x+y*y-r*r,D=B*B-4*A*C;if(D<=0)return null;
 const root=Math.sqrt(D),lo=Math.max(0,(-B-root)/(2*A)),hi=Math.min(1,(-B+root)/(2*A));return hi-lo>EPS?[lo,hi]:null;
}
function capsuleIntervals(a,b,c,d,r){
 const intervals=[];for(const p of [c,d]){const hit=circleInterval(a,b,p,r);if(hit)intervals.push(hit);}
 const ux=d[0]-c[0],uy=d[1]-c[1],len=Math.hypot(ux,uy);if(len<EPS)return intervals;
 const x=a[0]-c[0],y=a[1]-c[1],dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
 for(const [v,dv,min,max]of [[(x*ux+y*uy)/len,(dx*ux+dy*uy)/len,0,len],[(-x*uy+y*ux)/len,(-dx*uy+dy*ux)/len,-r,r]]){
  if(Math.abs(dv)<EPS){if(v<min||v>max||(min===-r&&Math.abs(v)>=r))return intervals;continue;}
  const t0=(min-v)/dv,t1=(max-v)/dv;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(hi-lo<=EPS)return intervals;
 }
 intervals.push([lo,hi]);return intervals;
}
function mergedIntervals(a,b,sweeps,r,stats){
 const found=[],bounds=segmentBounds(a,b);
 for(const sw of sweeps){if(!overlaps(bounds,sw.bounds))continue;if(stats)stats.segmentTests=(stats.segmentTests||0)+1;found.push(...capsuleIntervals(a,b,sw.a,sw.b,r));}
 found.sort((a,b)=>a[0]-b[0]);const out=[];for(const v of found){const prev=out[out.length - 1];if(prev&&v[0]<=prev[1]+EPS)prev[1]=Math.max(prev[1],v[1]);else out.push([...v]);}return out;
}
function cutStroke(stroke,sweeps,r,whole,stats){
 if(stroke.length===1)return mergedIntervals(stroke[0],stroke[0],sweeps,r,stats).length?[]:null;
 const pieces=[];let run=[],changed=false;
 const finish=()=>{if(run.length)pieces.push(run);run=[];};
 const keep=(a,b,lo,hi)=>{if(hi-lo<=EPS)return;const p=interpolate(a,b,lo),q=interpolate(a,b,hi);if(run.length&&Math.hypot(run[run.length - 1][0]-p[0],run[run.length - 1][1]-p[1])>EPS)finish();if(!run.length)run.push(p);if(!run[run.length - 1].every((v,i)=>Math.abs(v-q[i])<EPS))run.push(q);};
 for(let i=1;i<stroke.length;i++){
  const a=stroke[i-1],b=stroke[i],intervals=mergedIntervals(a,b,sweeps,r,stats);
  if(intervals.length){changed=true;if(whole)return [];}
  let from=0;for(const [lo,hi]of intervals){keep(a,b,from,lo);finish();from=hi;}keep(a,b,from,1);
 }
 finish();return changed?pieces:null;
}
export function erasePath(strokes,styles,path,radius,{wholeStroke=false,index=createStrokeIndex(strokes,styles),stats}={}){
 if(!path.length||!(radius>0))return {strokes,styles,changed:false,dirty:null};
 index.sync(strokes,styles);
 const sweeps=[],candidates=new Set();
 for(let i=0;i<Math.max(1,path.length-1);i++){const a=path[i],b=path[Math.min(i+1,path.length-1)],bounds=expand(segmentBounds(a,b),radius);sweeps.push({a,b,bounds});for(const s of index.query(bounds))candidates.add(s);}
 if(stats)stats.candidateStrokes=candidates.size;
 const replacements=new Map();let dirty=null;
 for(const s of candidates){const relevant=sweeps.filter(sw=>overlaps(strokeBounds(s),sw.bounds));if(!relevant.length)continue;if(stats)stats.visitedStrokes=(stats.visitedStrokes||0)+1;const pieces=cutStroke(s,relevant,radius,wholeStroke,stats);if(pieces){replacements.set(s,pieces);dirty=unionBounds(dirty,index.bounds(s));}}
 if(!replacements.size)return {strokes,styles,changed:false,dirty:null};
 const output=[],outputStyles=[];
 strokes.forEach((s,i)=>{const pieces=replacements.get(s),style=styles[i]||null;if(pieces){index.remove(s);for(const p of pieces){output.push(p);outputStyles.push(style);index.add(p,style);}}else{output.push(s);outputStyles.push(style);}});
 index.track(output);return {strokes:output,styles:outputStyles,changed:true,dirty};
}
