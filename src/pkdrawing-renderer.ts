// R3：canvas 画布脚本。解码部分由共享的 pkdrawing-core 提供——build.mjs 在构建期把
// src/pkdrawing-core-webview.ts 编译成 IIFE 并通过 __PKDRAWING_CORE_SCRIPT__ 注入；
// 本文件只保留画布专属逻辑（描线、底图叠放、错误展示）。
// PencilKit 数据格式说明与致谢：解码器遵循 libfreeform 的独立实现（MIT OR Apache-2.0）
// https://github.com/can1357/libfreeform
declare const __PKDRAWING_CORE_SCRIPT__: string

// 该 define 由 build.mjs 在构建期注入 pkdrawing-core 的 IIFE 文本；
// 测试等非 esbuild 环境没有它，此时画布脚本按缺核处理（逐 canvas 报解析失败）。
let coreScriptText = ""
try {
  coreScriptText = typeof __PKDRAWING_CORE_SCRIPT__ === "string" ? __PKDRAWING_CORE_SCRIPT__ : ""
} catch {
  coreScriptText = ""
}

const rendererBody = String.raw`
  var core = typeof __mnPkdrawingCore === 'undefined' ? null : __mnPkdrawingCore
  function esc(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  function strokeBounds(ss){var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    ss.forEach(function(s){s.points.forEach(function(p){minX=Math.min(minX,p.x-p.width);minY=Math.min(minY,p.y-p.width);maxX=Math.max(maxX,p.x+p.width);maxY=Math.max(maxY,p.y+p.width)})});
    return {minX:minX,minY:minY,maxX:maxX,maxY:maxY}}
  function paintLines(c,ss){c.lineCap='round';c.lineJoin='round';ss.forEach(function(s){if(s.points.length<2)return;
    c.strokeStyle=s.color;c.lineWidth=Math.max(1,s.points.reduce(function(v,p){return v+p.width},0)/s.points.length);
    c.beginPath();c.moveTo(s.points[0].x,s.points[0].y);for(var i=1;i<s.points.length;i++)c.lineTo(s.points[i].x,s.points[i].y);c.stroke()})}
  function draw(canvas){try{
    var ss=core.decodeStrokes(core.drawingData(canvas.getAttribute('data-drawing')));
    if(!ss.length)throw Error('笔迹为空');
    var bounds=strokeBounds(ss);
    if(canvas.getAttribute('data-drawing-overlay')==='true'){
      var img=canvas.parentElement&&canvas.parentElement.querySelector('img');
      if(!img)throw Error('手写底图缺失');
      var overlay=function(){
        if(!img.naturalWidth||!img.naturalHeight)return;
        var pad=8,w=Math.max(img.naturalWidth,Math.ceil(bounds.maxX+pad)),h=Math.max(img.naturalHeight,Math.ceil(bounds.maxY+pad));
        canvas.parentElement.style.aspectRatio=w+' / '+h;
        canvas.width=Math.ceil(w*devicePixelRatio);canvas.height=Math.ceil(h*devicePixelRatio);
        var c=canvas.getContext('2d');c.scale(devicePixelRatio,devicePixelRatio);paintLines(c,ss)
      };
      if(img.complete&&img.naturalWidth)overlay();else img.addEventListener('load',overlay);return
    }
    var pad=8,w=Math.max(1,bounds.maxX-bounds.minX+pad*2),h=Math.max(1,bounds.maxY-bounds.minY+pad*2),cssW=Math.min(900,w),scale=cssW/w;
    canvas.style.width=cssW+'px';canvas.style.height='auto';
    canvas.width=Math.ceil(cssW*devicePixelRatio);canvas.height=Math.ceil(h*scale*devicePixelRatio);
    var c=canvas.getContext('2d');c.scale(scale*devicePixelRatio,scale*devicePixelRatio);c.translate(-bounds.minX+pad,-bounds.minY+pad);paintLines(c,ss);
  }catch(e){canvas.outerHTML='<div class="missing-image">手写解析失败：'+esc(e&&e.message||e)+'</div>'}}
  Array.prototype.forEach.call(document.querySelectorAll('canvas[data-drawing]'),draw)`

// 用拼接而不是模板插值组装：注入的 core 文本可能含模板字符串字面量
export const pkDrawingRendererScript = "(function(){" + coreScriptText + rendererBody + "})();"
