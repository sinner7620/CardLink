import React, { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { readSceneSizePresets, removeSceneSizePreset, saveSceneSizePreset, setSceneWindowSize, readDefaultSceneSize, saveDefaultSceneSize, resetSceneWindowSize } from "./lib/sceneWindow"
import { SceneSizeGlass } from "./SceneSizeGlass"
import "./scene-window.css"

export function SceneWindowControls({ side = "left" }) {
  const [expanded, setExpanded] = useState(false), [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [defaultSize, setDefaultSize] = useState(() => readDefaultSceneSize());
  const [presets, setPresets] = useState(() => readSceneSizePresets());
  const drag = useRef(null), pending = useRef(null), timer = useRef(null), moved = useRef(false);
  useEffect(() => {
    function update() { setSize({ width: window.innerWidth, height: window.innerHeight }); }
    window.addEventListener("resize", update);
    const keydown = event => { if (event.key === "Escape") setExpanded(false); };
    const collapsed = () => setExpanded(false);
    window.addEventListener("keydown", keydown);
    window.addEventListener("mn:workbenchCollapse", collapsed);
    return () => {
      window.removeEventListener("resize", update); clearTimeout(timer.current);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("mn:workbenchCollapse", collapsed);
    };
  }, []);
  const resize = useCallback((width, height) => setSize(setSceneWindowSize(width, height)), []);
  const save = useCallback(() => setPresets(saveSceneSizePreset(window.innerWidth, window.innerHeight)), []);
  const remove = useCallback(preset => { setPresets(removeSceneSizePreset(preset.width, preset.height)); setDefaultSize(readDefaultSceneSize()); }, []);
  const selectDefault = useCallback(preset => setDefaultSize(saveDefaultSceneSize(preset.width, preset.height)), []);
  const reset = useCallback(() => setSize(resetSceneWindowSize()), []);
  const close = useCallback(() => setExpanded(false), []);
  function flush() {
    clearTimeout(timer.current); timer.current = null;
    if (pending.current) { resize(pending.current.width, pending.current.height); pending.current = null; }
  }
  function finish(cancelled = false) {
    if (cancelled) { clearTimeout(timer.current); timer.current = null; pending.current = null; }
    else flush();
    drag.current = null;
  }
  const resizeHandlers = {
    onPointerDown: event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.screenX, y: event.screenY, width: window.innerWidth, height: window.innerHeight };
        }, onPointerMove: event => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    if (Math.abs(event.screenX - start.x) + Math.abs(event.screenY - start.y) > 4) moved.current = true;
    pending.current = { width: start.width + event.screenX - start.x, height: start.height + event.screenY - start.y };
    if (!timer.current) timer.current = setTimeout(flush, 70);
        }, onPointerUp: event => {
    if (drag.current?.id !== event.pointerId) return;
    finish();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }, onPointerCancel: () => finish(true), onLostPointerCapture: () => finish(true), onKeyDown: event => {
    const step = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
    if (step) { event.preventDefault(); resize(window.innerWidth + step[0], window.innerHeight + step[1]); }
        }
  };
  return <>
    {expanded && createPortal(<div className="sceneSizePopover" data-side={side} role="dialog" aria-label="窗口大小">
      <SceneSizeGlass size={size} presets={presets} defaultSize={defaultSize} onDefault={selectDefault} onReset={reset} onResize={resize} onSave={save} onRemove={remove} onClose={close} />
    </div>, document.body)}
    {createPortal(<button type="button" className="sceneResizeGrip" aria-label="右下角拖动缩放窗口" title="拖动缩放；点击设置尺寸；方向键微调" aria-expanded={expanded}
      {...resizeHandlers} onClick={() => { if (!moved.current) setExpanded(value => !value); }}><svg viewBox="0 0 44 44" aria-hidden="true"><path d="M12 35C27 35 35 27 35 12" /></svg></button>, document.body)}
  </>;
}
