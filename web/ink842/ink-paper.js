// Quickdraw-inspired zoom-adaptive lattice: intermediate lines fade in between octaves.
export const PAGE_SIZES={a4:[1000,1414],a5:[707,1000],letter:[1000,1294],landscape:[1414,1000]};
export function paintPaper(ctx,answer,bounds,scale=1){
 const kind=answer.background||'none';if(kind==='none')return;
 let step=20;while(step*scale<12)step*=2;while(step*scale>=24)step/=2;
 const fade=step*scale/12-1,point=kind==='dots'||kind==='crosses';
 const left=answer.pageSize==='infinite'?bounds.minX:Math.max(0,bounds.minX),right=answer.pageSize==='infinite'?bounds.maxX:Math.min(answer.width||1000,bounds.maxX);
 const top=answer.pageSize==='infinite'?bounds.minY:Math.max(0,bounds.minY),bottom=answer.pageSize==='infinite'?bounds.maxY:Math.min(answer.height,bounds.maxY);
 ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();ctx.strokeStyle=point?'#9faeaa':'#c7d4ce';ctx.fillStyle='#9faeaa';ctx.lineWidth=1/scale;
 for(let pass=0;pass<2;pass++){
 ctx.globalAlpha=pass?fade:1;ctx.beginPath();
 for(let y=Math.floor(top/step)*step;y<=bottom;y+=step){const row=Math.round(y/step);
  if(point){for(let x=Math.floor(left/step)*step;x<=right;x+=step){if((row%2===0&&Math.round(x/step)%2===0)!==!pass)continue;if(kind==='dots'){ctx.moveTo(x+1/scale,y);ctx.arc(x,y,1/scale,0,Math.PI*2);}else{ctx.moveTo(x-3/scale,y);ctx.lineTo(x+3/scale,y);ctx.moveTo(x,y-3/scale);ctx.lineTo(x,y+3/scale);}}}
  else if(kind!=='iso'&&(row%2===0)===!pass){ctx.moveTo(left,y);ctx.lineTo(right,y);}
 }
 if(kind==='lines')for(let x=Math.floor(left/step)*step;x<=right;x+=step)if((Math.round(x/step)%2===0)===!pass){ctx.moveTo(x,top);ctx.lineTo(x,bottom);}
 if(kind==='iso')for(const slope of [-1/Math.sqrt(3),1/Math.sqrt(3)]){const lo=top-Math.max(slope*left,slope*right),hi=bottom-Math.min(slope*left,slope*right);for(let k=Math.floor(lo/step);k*step<=hi;k++)if((k%2===0)===!pass){ctx.moveTo(left,k*step+slope*left);ctx.lineTo(right,k*step+slope*right);}}
 if(kind==='dots')ctx.fill();else ctx.stroke();
 }ctx.restore();
}
export function inPolygon(p,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function perfectShape(points){
 if(points.length<8)return null;
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
 const first=points[0],last=points[points.length - 1],d=Math.hypot(last[0]-first[0],last[1]-first[1]);
 const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
 const make=pts=>pts.map((p,i)=>[...p,.5,i*10]);
 if(d>35&&length/d<1.08)return make([first.slice(0,2),last.slice(0,2)]);
 if(w<30||h<30||d>Math.max(w,h)*.22)return null;
 const edge=points.reduce((s,p)=>s+Math.min(Math.abs(p[0]-x),Math.abs(p[0]-x-w),Math.abs(p[1]-y),Math.abs(p[1]-y-h)),0)/points.length;
 if(edge<Math.min(w,h)*.075&&[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].every(c=>points.some(p=>Math.hypot(p[0]-c[0],p[1]-c[1])<Math.min(w,h)*.15)))return make([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]);
 const error=points.reduce((s,p)=>s+Math.abs(Math.hypot((p[0]-x-w/2)/(w/2),(p[1]-y-h/2)/(h/2))-1),0)/points.length;
 if(error>.13)return null;
 return make(Array.from({length:65},(_,i)=>[x+w/2+w/2*Math.cos(i*Math.PI/32),y+h/2+h/2*Math.sin(i*Math.PI/32)]));
}
