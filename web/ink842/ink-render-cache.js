// Cache the existing renderer's exact operations, rather than changing the nib
// or smoothing algorithm. Shared and bounded across all answer canvases.
const pathMethods=new Set(['moveTo','lineTo','quadraticCurveTo','bezierCurveTo','arc','arcTo','ellipse','rect','closePath']);
function compile(operations){
 if(typeof Path2D==='undefined')return operations;
 let path=null;const output=[];
 for(const op of operations){
  if(op[0]==='beginPath'){path=new Path2D();continue;}
  if(path&&pathMethods.has(op[0])){path[op[0]](...op.slice(1));continue;}
  if(path&&(op[0]==='fill'||op[0]==='stroke'))output.push([op[0],path,...op.slice(1)]);
  else output.push(op);
 }
 return output;
}
export function createInkRenderCache(limit=60000){
 const entries=new Map();let weight=0;
 return {
  paint(ctx,points,style,draw){
   const cached=entries.get(points);
   if(cached&&cached.style===style&&cached.length===points.length&&cached.last===points[points.length - 1]){
    entries.delete(points);entries.set(points,cached);
    for(const [method,...args]of cached.operations){if(method==='=')ctx[args[0]]=args[1];else ctx[method](...args);}
    return;
   }
   if(cached){entries.delete(points);weight-=cached.weight;}
   const operations=[];
   const recorder=new Proxy(ctx,{
    get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{operations.push([key,...args]);return value.apply(target,args);};},
    set(target,key,value){operations.push(['=',key,value]);return Reflect.set(target,key,value,target);}
   });
   draw(recorder,points,style);
   if(operations.length>limit)return;
   const entry={style,length:points.length,last:points[points.length - 1],operations:compile(operations),weight:operations.length};
   entries.set(points,entry);weight+=entry.weight;
   while(weight>limit){const first=entries.keys().next().value;weight-=entries.get(first).weight;entries.delete(first);}
  },
  get size(){return entries.size;},
  get weight(){return weight;}
 };
}
