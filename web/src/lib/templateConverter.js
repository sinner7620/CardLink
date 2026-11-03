import * as zip from 'fflate'
import { configure, pack, methods, reasons, ID } from './templateConfiguration'

export const CARDLINK_ID = ID
export const TEMPLATE_REASONS = reasons
export const MAX_TEMPLATE_BYTES = 16 * 1024 * 1024

export function convertSceneTemplate(bytes) {
  if (bytes.length > MAX_TEMPLATE_BYTES) throw Error('请选择 16 MB 以内的模板')
  let expanded = 0
  const files = zip.unzipSync(bytes, { filter(entry) {
    expanded += entry.originalSize
    if (expanded > 100 * 1024 * 1024) throw Error('模板解压后超过 100 MB')
    return true
  } })
  const object = (name) => {
    if (!files[name]) throw Error('压缩包缺少 ' + name)
    const result = JSON.parse(zip.strFromU8(files[name]))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(name + ' 格式不正确')
    return result
  }
  const template = object('template.json'), manifest = object('manifest.json')
  if (typeof template.id !== 'string' || !template.id.trim() || typeof template.name !== 'string' || !template.name.trim()) throw Error('模板缺少有效的 id 或 name')
  for (const [field, value] of [['plugins', template.plugins], ['manifest.plugins', manifest.plugins]]) {
    if (value != null && !Array.isArray(value)) throw Error(field + ' 格式不正确')
  }
  for (const field of ['pluginConfigs', 'selectionMenu']) {
    if (template[field] != null && (typeof template[field] !== 'object' || Array.isArray(template[field]))) throw Error('模板 ' + field + ' 格式不正确')
  }
  for (const kind of ['cards', 'documents']) if (template.selectionMenu?.[kind] != null && !Array.isArray(template.selectionMenu[kind])) throw Error('模板菜单格式不正确：' + kind)
  const result = configure(files, zip)
  const output = pack(methods(bytes), result.files, zip)
  if (output.length > MAX_TEMPLATE_BYTES) throw Error('转换后的模板超过 16 MB，无法在插件内导出')
  return { bytes: output, name: result.name, version: result.version }
}

export function convertedTemplateFilename(name) {
  return name.replace(/(\.[^./]+)?$/, (_match, ext) => '（转换后）' + (ext || '.mntemplate'))
}

export function templateBase64(bytes) {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
  return btoa(binary)
}
