export function sceneWindowSize(width, height) {
  const w = Number(width), h = Number(height);
  // screen dimensions can reflect the panel itself. Do not use them as an
  // upper bound: that makes a resize request narrower than the current panel.
  return { width: Math.round(Math.max(360, Number.isFinite(w) && w !== 0 ? w : 640)), height: Math.round(Math.max(360, Math.min(1000, Number.isFinite(h) && h !== 0 ? h : 620))) };
}
export function setSceneWindowSize(width, height, win = window) {
  const size = sceneWindowSize(width, height);
  win.mn.size(size.width, size.height);
  try { win.localStorage.setItem("cardlink.scene.windowSize", JSON.stringify(size)); } catch {}
  return size;
}

const PRESETS_KEY = "cardlink.scene.sizePresets";
export const DEFAULT_SCENE_PRESETS = [
  { label: "紧凑", width: 480, height: 540 },
  { label: "标准", width: 720, height: 520 },
  { label: "宽屏", width: 900, height: 720 }
];
export function readSceneSizePresets(win = window) {
  let stored;
  try { stored = JSON.parse(win.localStorage.getItem(PRESETS_KEY) || "[]"); } catch { return []; }
  if (!Array.isArray(stored)) return [];
  const seen = new Set();
  return stored.filter(item => {
    if (!Number.isInteger(item?.width) || item.width < 360 || !Number.isInteger(item?.height) || item.height < 360 || item.height > 1000) return false;
    const key = `${item.width}×${item.height}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(({ width, height }) => ({ width, height }));
}
export function saveSceneSizePreset(width, height, win = window) {
  const size = sceneWindowSize(width, height);
  const presets = readSceneSizePresets(win);
  if (!presets.some(item => item.width === size.width && item.height === size.height)) presets.push(size);
  win.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}
export function removeSceneSizePreset(width, height, win = window) {
  const selected = readDefaultSceneSize(win);
  if (selected.width === width && selected.height === height) saveDefaultSceneSize(720, 520, win);
  const presets = readSceneSizePresets(win).filter(item => item.width !== width || item.height !== height);
  win.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

const DEFAULT_PRESET_KEY = "cardlink.scene.defaultSizePreset";
export function readDefaultSceneSize(win = window) {
  try {
    const size = JSON.parse(win.localStorage.getItem(DEFAULT_PRESET_KEY) || "null");
    if (Number.isInteger(size?.width) && size.width >= 360 && Number.isInteger(size?.height) && size.height >= 360 && size.height <= 1000) return size;
  } catch {}
  return { width: 720, height: 520 };
}
export function saveDefaultSceneSize(width, height, win = window) {
  const preset = [...DEFAULT_SCENE_PRESETS, ...readSceneSizePresets(win)].find(item => item.width === width && item.height === height);
  if (!preset) throw new Error("请选择已有预设");
  const size = { width: preset.width, height: preset.height };
  win.localStorage.setItem(DEFAULT_PRESET_KEY, JSON.stringify(size));
  return size;
}
export function resetSceneWindowSize(win = window, sdk = win.mn) {
  const size = readDefaultSceneSize(win);
  sdk.size(size.width, size.height);
  try { win.localStorage.setItem("cardlink.scene.windowSize", JSON.stringify(size)); } catch {}
  return size;
}
