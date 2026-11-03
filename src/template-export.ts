import { saveFile, MN, genNSURL } from 'marginnote'
import { cardLinkTempPath, ensureStorageDirectory } from './storage-paths'
import { TEMPLATE_CONVERTER_URL } from './template-converter-link'
import { decodeBase64Ascii } from './base64'

export function openTemplateConverter(): { opened: true } {
  MN.app.openURL(genNSURL(TEMPLATE_CONVERTER_URL, true))
  return { opened: true }
}

export function exportSceneTemplate(payload: { filename?: string; base64?: string }): { saved: true; filename: string } {
  const base64 = payload?.base64
  if (typeof base64 !== 'string' || base64.length > 24 * 1024 * 1024 || !/^UEs[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('模板导出数据无效或超过大小限制')
  const filename = String(payload.filename || 'CardLink.mntemplate').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.mntemplate$/i, '').slice(0, 100) + '.mntemplate'
  const directory = cardLinkTempPath('templates')
  if (!directory || !ensureStorageDirectory(directory)) throw new Error('模板导出目录不可用')
  // Use the same Latin-1 binary bridge as PDF export and native image uploads.
  const data = NSData.dataWithStringEncoding(decodeBase64Ascii(base64), 5)
  const path = `${directory}/${filename}`
  if (!data || !data.writeToFileAtomically(path, true)) throw new Error('模板文件写入失败')
  saveFile(path, 'public.zip-archive')
  return { saved: true, filename }
}
