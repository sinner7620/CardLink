/* CardLink 模板配置转换：只改配置，不嵌入插件。文件不离浏览器。 */
const root = globalThis;
  const ID = 'marginnote.extension.mn4-answer-matcher';
  const TITLE = 'CardLink';
  const version = '2.4.6-b69';
  const reasons = ['概念不清','公式遗忘','思路受阻','计算失误','审题遗漏','时间不足'].map((label,i)=>({key:['concept','formula','approach','calculation','reading','time'][i],label}));

  /* 读取原始 zip 每个条目的压缩方式，返回 {条目名: 是否压缩} */
  function methods(buf) {
    const out={}, utf8=root.TextDecoder?new root.TextDecoder():{decode:b=>String.fromCharCode.apply(null,b)};
    let p=0;
    while(p+4<=buf.length && buf[p]===0x50 && buf[p+1]===0x4b && buf[p+2]===0x03 && buf[p+3]===0x04) {
      const method=buf[p+8]|(buf[p+9]<<8);
      const csize=buf[p+18]|(buf[p+19]<<8)|(buf[p+20]<<16)|(buf[p+21]<<24);
      const nlen=buf[p+26]|(buf[p+27]<<8), elen=buf[p+28]|(buf[p+29]<<8);
      const name=utf8.decode(buf.subarray(p+30,p+30+nlen));
      out[name]=method!==0;
      if(csize===0 && method!==0) break;
      p += 30+nlen+elen+csize;
    }
    return out;
  }

  /* 仅写配置：template.json 登记插件与作答配置，manifest.json 登记插件依赖 */
  function configure(templateFiles, zip) {
    const parse = (files,name) => { if(!files[name]) throw Error('压缩包缺少 '+name); return JSON.parse(zip.strFromU8(files[name])); };
    const template=parse(templateFiles,'template.json'), manifest=parse(templateFiles,'manifest.json');
    if(typeof template.id!=='string' || typeof template.name!=='string') throw Error('模板缺少有效的 id 或 name');
    /* 模板内部名称与 id 保持原样，不做任何追加 */
    template.plugins=Array.from(new Set([...(template.plugins||[]),ID]));
    template.pluginConfigs ||= {};
    template.pluginConfigs[ID]={...(template.pluginConfigs[ID]||{}),v:1,tagPrefix:template.pluginConfigs[ID]?.tagPrefix||'cardlink-practice',reasons};
    template.selectionMenu ||= {};
    for(const kind of ['cards','documents']) template.selectionMenu[kind]=Array.from(new Set([...(template.selectionMenu[kind]||[]),...['findAnswer','markMistake'].map(command=>'addon.'+ID+'.'+command+':')]));
    manifest.template={...(manifest.template||{}),id:template.id,name:template.name};
    manifest.plugins=[...(manifest.plugins||[]).filter(p=>p.pluginID!==ID),{pluginID:ID,title:TITLE,version}];
    const output={};
    for(const [name,data] of Object.entries(templateFiles)) output[name]=data;
    output['template.json']=zip.strToU8(JSON.stringify(template,null,2));
    output['manifest.json']=zip.strToU8(JSON.stringify(manifest,null,2));
    return {files:output,name:template.name,version,reasons};
  }

  function crc32(buf) {
    let c, crc=0xFFFFFFFF;
    for(let i=0;i<buf.length;i++){ c=(crc^buf[i])&0xFF; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; crc=(crc>>>8)^c; }
    return (crc^0xFFFFFFFF)>>>0;
  }
  const LE=(arr,n,len)=>{ for(let i=0;i<len;i++) arr.push((n>>>(8*i))&0xFF); };

  /* 按原条目压缩方式重新封装，逐条目写 存储(0) 或 deflate(8)，保留顺序与目录项 */
  function pack(methods, files, zip) {
    const utf8=root.TextEncoder?new root.TextEncoder():{encode:s=>Uint8Array.from(unescape(encodeURIComponent(s)),c=>c.charCodeAt(0))};
    const parts=[], central=[];
    let offset=0;
    const now=new Date();
    const time=((now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()/2))&0xFFFF;
    const date=(((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate())&0xFFFF;
    const names=Object.keys(files);
    for(const name of names) {
      const nameBytes=utf8.encode(name);
      const raw=files[name];
      const data=raw instanceof Uint8Array?raw:new Uint8Array(raw);
      let body=data, method=0;
      if(methods[name]!==false) {
        const deflated=zip.deflateSync(data,{level:6});
        if(deflated.length<data.length){ body=deflated; method=8; }
      }
      const crc=crc32(data);
      const head=[];
      LE(head,0x04034b50,4); LE(head,20,2); LE(head,0x0800,2); LE(head,method,2);
      LE(head,time,2); LE(head,date,2); LE(head,crc,4); LE(head,body.length,4); LE(head,data.length,4);
      LE(head,nameBytes.length,2); LE(head,0,2);
      parts.push(new Uint8Array(head), nameBytes, body);
      const cen=[];
      LE(cen,0x02014b50,4); LE(cen,20,2); LE(cen,20,2); LE(cen,0x0800,2); LE(cen,method,2);
      LE(cen,time,2); LE(cen,date,2); LE(cen,crc,4); LE(cen,body.length,4); LE(cen,data.length,4);
      LE(cen,nameBytes.length,2); LE(cen,0,2); LE(cen,0,2); LE(cen,0,2); LE(cen,0,2); LE(cen,0,4); LE(cen,offset,4);
      central.push(new Uint8Array(cen), nameBytes);
      offset += head.length+nameBytes.length+body.length;
    }
    const cdSize=central.reduce((n,a)=>n+a.length,0);
    const end=[]; LE(end,0x06054b50,4); LE(end,0,2); LE(end,0,2);
    LE(end,names.length,2); LE(end,names.length,2); LE(end,cdSize,4); LE(end,offset,4); LE(end,0,2);
    const all=[...parts,...central,new Uint8Array(end)];
    const total=all.reduce((n,a)=>n+a.length,0), out=new Uint8Array(total);
    let pos=0; for(const a of all){ out.set(a,pos); pos+=a.length; }
    return out;
  }
export { configure, pack, methods, reasons, ID, TITLE, version };
