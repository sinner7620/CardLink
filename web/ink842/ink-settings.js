export const INK_SETTINGS_KEY = 'cardlink-842-ink-tools-v2';
export const INK_SETTINGS_EVENT = 'cardlink-842-ink-settings';
export const INK_COLORS = [['#1c1917','黑'],['#2563eb','蓝'],['#dc2626','红'],['#16804a','绿'],['#9333ea','紫'],['#f59e0b','橙']];
export const PEN_SIZES = [1,2,3.2,4.8,7,10,12];
export const MARKER_SIZES = [8,16,24,32];
export const FEEL_CONTROLS = [
 ['tipSharpness','出锋',0,1,.01,.8],['pressureSensitivity','压力',0,1,.01,.5],['flatness','扁平',0,1,.01,0],
 ['stabilization','稳定',0,2,.01,.9],['rectification','纠偏',0,1,.01,1],
 ['smoothing','平滑',0,1,.01,.6],['wobbleFilter','微颤过滤',0,1,.01,.6],
 ['pressureFloor','轻写底座',.05,.8,.01,.2],['pressureCeiling','重压封顶',.8,2,.01,1],['pressureGain','压力增益',.5,3,.1,1.4]
];
export const FEEL_DEFAULTS=Object.fromEntries(FEEL_CONTROLS.map(([key,,,,,value])=>[key,value]));
export const DEFAULT_INK_SETTINGS = {tool:'pen',lastDrawTool:'pen',penType:'fountain',color:'#1c1917',markerColor:'#facc15',size:2,markerSize:24,pressure:true,eraserSize:13,eraserMode:'partial',eraserAutoReturn:true,scribble:true,...FEEL_DEFAULTS};
let sessionSettings = null;
export function normalizeInkSettings(value = {}) {
 const s = {...DEFAULT_INK_SETTINGS};
 if (!value || typeof value !== 'object') return s;
 if (['pen','marker','line','eraser','lasso'].includes(value.tool)) s.tool=value.tool;
 if (['pen','marker','line','lasso'].includes(value.lastDrawTool))s.lastDrawTool=value.lastDrawTool;
 if (['fountain','ballpoint','brush'].includes(value.penType))s.penType=value.penType;
 if(['partial','stroke'].includes(value.eraserMode))s.eraserMode=value.eraserMode;
 for (const key of ['color','markerColor']) if (/^#[0-9a-f]{6}$/i.test(value[key]||'')) s[key]=value[key];
 for(const [key,min,max]of [['size',.5,12],['markerSize',8,32],['eraserSize',4,40]])if(Number.isFinite(value[key])&&value[key]>=min&&value[key]<=max)s[key]=value[key];
 for(const [key,,min,max]of FEEL_CONTROLS)if(Number.isFinite(value[key])&&value[key]>=min&&value[key]<=max)s[key]=value[key];
 for (const key of ['pressure','scribble','eraserAutoReturn']) if (typeof value[key]==='boolean') s[key]=value[key];
 return s;
}
export function loadInkSettings() {
 if(sessionSettings)return {...sessionSettings};
 try { return normalizeInkSettings(JSON.parse(localStorage.getItem(INK_SETTINGS_KEY)||'{}')); }
 catch { return normalizeInkSettings(); }
}
export function saveInkSettings(settings) {
 const safe=normalizeInkSettings(settings);
 try { localStorage.setItem(INK_SETTINGS_KEY,JSON.stringify(safe)); sessionSettings=null; } catch { sessionSettings=safe; }
 return safe;
}
export const strokeStyle = settings => ({engine:'goodnotes-ink-v2',feel:Object.fromEntries(FEEL_CONTROLS.map(([key])=>[key,settings[key]])),penType:settings.penType,line:settings.tool==='line',size:settings.tool==='marker'?settings.markerSize:settings.size,pressure:settings.tool==='pen'&&settings.pressure,color:settings.tool==='marker'?settings.markerColor:settings.color,kind:settings.tool==='marker'?'marker':'pen'});
export function validInkStyle(s) {
 return s===null || !!s && typeof s==='object' && Number.isFinite(s.size) && s.size>=.5 && s.size<=(s.kind==='marker'?32:12) && typeof s.pressure==='boolean' && (s.color===undefined || typeof s.color==='string' && /^#[0-9a-f]{6}$/i.test(s.color)) && (s.kind===undefined || ['pen','marker'].includes(s.kind)) && (s.engine===undefined||['goodnotes-ink-v1','goodnotes-ink-v2'].includes(s.engine)) && (s.penType===undefined||['fountain','ballpoint','brush'].includes(s.penType)) && (s.line===undefined||typeof s.line==='boolean') && (s.inputScale===undefined||Number.isFinite(s.inputScale)&&s.inputScale>=.025&&s.inputScale<=16) && (s.feel===undefined||!!s.feel&&typeof s.feel==='object'&&!Array.isArray(s.feel)&&FEEL_CONTROLS.every(([key,,min,max])=>Number.isFinite(s.feel[key])&&s.feel[key]>=min&&s.feel[key]<=max));
}
