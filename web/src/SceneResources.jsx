import React, { useEffect, useRef, useState } from "react"
import { hydrateSceneDocument, prepareSceneHtml, publishSceneImage, releaseSceneImages } from "./lib/sceneResources"

export function ResourceImage({ src, ...props }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false, key;
    setUrl(""); setError("");
    if (!window.__MN_SCENE_ENABLED__) { setUrl(src); return; }
    publishSceneImage(src).then(result => {
      if (disposed) { releaseSceneImages([result.key].filter(Boolean)); return; }
      key = result.key; setUrl(result.url);
    }).catch(reason => { if (!disposed) setError(reason.message); });
    return () => { disposed = true; releaseSceneImages([key].filter(Boolean)); };
  }, [src, retry]);
  return error ? <span role="alert">图片加载失败：{error}<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></span> : url ? <img {...props} src={url} onError={() => setError("图片资源无法读取")} /> : <span role="status">正在读取图片…</span>;
}

export function PreviewFrame({ html, onLoad, onError, ...props }) {
  const frame = useRef(null), callbacks = useRef({ onLoad, onError }), [ready, setReady] = useState(0), [error, setError] = useState("");
  callbacks.current = { onLoad, onError };
  const scene = window.__MN_SCENE_ENABLED__;
  useEffect(() => {
    if (!scene || !ready) return;
    let disposed = false, keys = [];
    setError("");
    prepareSceneHtml(html).then(result => {
      if (disposed) { releaseSceneImages(result.keys); return; }
      keys = result.keys;
      hydrateSceneDocument(frame.current.contentDocument, result.html, reason => {
        if (!disposed) { setError(reason.message); callbacks.current.onError?.(reason); }
      });
      callbacks.current.onLoad?.({ currentTarget: frame.current });
    }).catch(reason => {
      if (!disposed) { setError(reason.message); callbacks.current.onError?.(reason); }
    });
    return () => { disposed = true; releaseSceneImages(keys); };
  }, [scene, ready, html]);
  if (!scene) return <iframe {...props} ref={frame} srcDoc={html} onLoad={onLoad} />;
  return <><iframe {...props} ref={frame} style={{ ...props.style, ...(error ? { display: "none" } : {}) }} src="/pkg/web-dist/preview.html" onLoad={() => setReady(value => value + 1)} />{error && <div role="alert">预览加载失败：{error}<button type="button" onClick={() => setReady(value => value + 1)}>重试</button></div>}</>;
}
