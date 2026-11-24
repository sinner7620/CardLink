import React, { useEffect, useReducer, useRef, useState } from 'react'
import MNBridge from './lib/mnBridge'
import { PreviewFrame } from './SceneResources'
import { ensureHtml2Canvas } from './lib/html2canvas-loader.mjs'
import { sceneCaptureOptions } from './lib/sceneResources'

export function OCRCapture({ item, onDone, onError }) {
  const mounted = useRef(true), captured = useRef(false)
  const send = MNBridge.send
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      void send('ocrDbReleaseCapture', {jobId:item.jobId,lease:item.lease}).catch(() => {})
    }
  }, [item.lease])

  async function fail(reason) {
    if (!mounted.current) return
    try {
      await send('ocrDbFailCapture', {jobId:item.jobId,lease:item.lease})
    } catch { /* The lease may already have been superseded. */ } finally {
      if (mounted.current) { onError?.(reason); onDone() }
    }
  }
  async function render(event){
    if (!mounted.current || captured.current) return
    captured.current=true
    try{
      const doc=event.currentTarget.contentDocument
      if(!doc?.body)throw new Error('题目渲染窗口不可用')
      await doc.fonts?.ready
      await Promise.all([...doc.images].map(img=>new Promise((resolve,reject)=>{
        if(img.complete)return img.naturalWidth?resolve():reject(new Error('题目图片缺失'))
        const timeout=setTimeout(()=>done(false),15000)
        function done(ok){clearTimeout(timeout);img.removeEventListener('load',yes);img.removeEventListener('error',no);ok?resolve():reject(new Error('题目图片读取失败'))}
        const yes=()=>done(true),no=()=>done(false);img.addEventListener('load',yes,{once:true});img.addEventListener('error',no,{once:true})
      })))
      const h2c=await ensureHtml2Canvas(), width=Math.max(640,doc.body.scrollWidth), height=Math.max(1,doc.body.scrollHeight)
      if(Math.ceil(height/2400)>30)throw new Error('题目过长，请拆分后识别')
      const images=[]
      for(let y=0;y<height;y+=2400){
        if(!mounted.current)throw new Error('截图已暂停')
        const canvas=await h2c(doc.body,{...sceneCaptureOptions(doc),backgroundColor:'#ffffff',logging:false,useCORS:true,scale:1.25,width,height:Math.min(2400,height-y),y,windowWidth:width,windowHeight:height})
        images.push(canvas.toDataURL('image/jpeg',.9));canvas.width=1;canvas.height=1
      }
      if (!mounted.current) return
      await send('ocrDbSubmitImages',{jobId:item.jobId,lease:item.lease,images})
      if (mounted.current) onDone()
    }catch(reason){await fail(reason)}
  }
  return <PreviewFrame className="ocrCapture" title="OCR 题干渲染" html={item.html} onLoad={render} onError={reason=>void fail(reason).catch(()=>{})} tabIndex={-1} aria-hidden="true"/>
}

export function OCRBackground({ pulse, enabled, onIndexed, onActive }) {
  const [capture, setCapture] = useState(null)
  const [visible, setVisible] = useState(false)
  const [scheduledPulse, requestQueue] = useReducer(value => value + 1, 0)
  const foreground = useRef(true)
  const manualQueueIdle = useRef(enabled)
  manualQueueIdle.current = enabled
  const current = useRef(null)
  useEffect(() => {
    let panelOpen = true
    let checking = false
    async function check() {
      if (!foreground.current || !manualQueueIdle.current || checking) return
      checking = true
      try {
        const result = await MNBridge.send('ocrDbAutoTick')
        if (result.started && panelOpen) requestQueue()
      } catch (error) {
        void MNBridge.send('runtimeLog', { event: 'ocr.schedule.failed', detail: String(error.message || error) }).catch(() => {})
      } finally {
        checking = false
      }
    }
    function updateVisibility() {
      foreground.current = panelOpen && !document.hidden
      setVisible(foreground.current)
    }
    function show() {
      panelOpen = true
      updateVisibility()
      void check()
    }
    function hide() { panelOpen = false; updateVisibility() }
    window.addEventListener('cardlink-panel-show', show)
    window.addEventListener('cardlink-panel-hide', hide)
    document.addEventListener('visibilitychange', updateVisibility)
    show()
    return () => {
      window.removeEventListener('cardlink-panel-show', show)
      window.removeEventListener('cardlink-panel-hide', hide)
      document.removeEventListener('visibilitychange', updateVisibility)
      panelOpen = false
    }
  }, [])
  useEffect(() => {
    if (!enabled || !visible) return
    let stopped = false, timer, worked = false
    async function tick() {
      if (stopped || !foreground.current) return
      if (current.current) { timer = setTimeout(tick, 1400); return }
      try {
        const next = await MNBridge.send('ocrDbNext', {automatic:true})
        if (stopped || !foreground.current) {
          if (next.html) void MNBridge.send('ocrDbReleaseCapture', {jobId:next.jobId,lease:next.lease}).catch(()=>{})
          return
        }
        if (next.idle || next.paused) {
          onActive(false)
          if (worked) onIndexed()
          return
        }
        worked = true
        onActive(true)
        if (next.html) { current.current = next; setCapture(next) }
        timer = setTimeout(tick, 1400)
      } catch {
        if (!stopped) {
          onActive(false)
          if (worked) onIndexed()
        }
      }
    }
    void tick()
    return () => { stopped = true; clearTimeout(timer); onActive(false) }
  }, [enabled,visible,pulse,scheduledPulse,onIndexed,onActive])
  useEffect(() => {
    if (!enabled || !visible) { current.current = null; setCapture(null) }
  }, [enabled,visible])
  return enabled && visible && capture && <OCRCapture key={capture.lease} item={capture} onDone={()=>{current.current=null;setCapture(null)}}/>
}
