import React, { useState } from 'react'
import './ui/template-converter.css'
import MNBridge from './lib/mnBridge'
import { convertSceneTemplate, convertedTemplateFilename, templateBase64, MAX_TEMPLATE_BYTES } from './lib/templateConverter'
import { TEMPLATE_CONVERTER_URL } from '../../src/template-converter-link'

export function TemplateConverter() {
  const [file, setFile] = useState(null), [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  async function convert() {
    if (!file || busy) return
    setBusy(true); setStatus('正在转换…')
    try {
      if (file.size > MAX_TEMPLATE_BYTES) throw Error('请选择 16 MB 以内的模板')
      const result = convertSceneTemplate(new Uint8Array(await file.arrayBuffer()))
      const filename = convertedTemplateFilename(file.name)
      if (window.__MN_FULL_UI_PREVIEW__ || ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/zip' }))
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 60000)
      } else await MNBridge.send('exportSceneTemplate', { filename, base64: templateBase64(result.bytes) })
      setStatus('转换完成，已打开导出。')
    } catch (error) { setStatus('转换失败：' + (error.message || error)) }
    finally { setBusy(false) }
  }
  return <div className="templateConverter">
    <label>上传模板<input aria-label="上传场景模板" type="file" accept=".mntemplate" disabled={busy} style={{ display: 'block', maxWidth: '100%', margin: '12px 0' }} onChange={event => { setFile(event.target.files?.[0] || null); setStatus('') }} /></label>
    <p>文件仅在本机处理，支持16 MB 以内的模板。</p>
    <button type="button" disabled={!file || busy} onClick={convert}>{busy ? '正在转换…' : '转换并导出模板'}</button>
    <p role="status" aria-live="polite">{status}</p>
    <p>若文件过大请使用<a href={TEMPLATE_CONVERTER_URL} target="_blank" rel="noopener noreferrer" onClick={async event => {
      if (window.__MN_FULL_UI_PREVIEW__ || ['localhost', '127.0.0.1'].includes(window.location.hostname)) return
      event.preventDefault()
      try { await MNBridge.send('openTemplateConverter') }
      catch (error) { setStatus('打开在线转换失败：' + (error.message || error)) }
    }}>在线转换</a>。</p>
  </div>
}
