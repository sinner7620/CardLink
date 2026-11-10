import { getLocalDataByKey, setLocalDataByKey } from 'marginnote'
import { loadMistakeState } from './mistake-store'

// b57 already used these keys for the SQLite providers. Keep the settings and
// tokens in place so switching versions does not require a data migration.
const settingsKey = 'mn4-answer-matcher.ai.settings.v1'
const credentialsKey = 'mn4-answer-matcher.ai.credentials.v1'
const defaults = {
  mineru: { baseUrl: 'https://mineru.net', credentialRef: 'ocr-mineru', language: 'ch', enableFormula: true, enableTable: true },
  glmOcr: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', credentialRef: 'ocr-glm', timeoutMs: 120000 },
}

function normalize(value: any) {
  const mineru = value?.mineru, glm = value?.glmOcr
  return {
    ocrEngine: value?.ocrEngine === 'glm-ocr' ? 'glm-ocr' as const : 'mineru' as const,
    mineru: {
      baseUrl: String(mineru?.baseUrl || defaults.mineru.baseUrl).replace(/\/+$/, ''),
      credentialRef: String(mineru?.credentialRef || defaults.mineru.credentialRef),
      language: String(mineru?.language || defaults.mineru.language),
      enableFormula: mineru?.enableFormula !== false,
      enableTable: mineru?.enableTable !== false,
    },
    glmOcr: {
      baseUrl: String(glm?.baseUrl || defaults.glmOcr.baseUrl).replace(/\/+$/, '').replace(/\/layout_parsing$/i, ''),
      credentialRef: String(glm?.credentialRef || defaults.glmOcr.credentialRef),
      timeoutMs: Math.min(180000, Math.max(10000, Number(glm?.timeoutMs) || defaults.glmOcr.timeoutMs)),
    },
  }
}

let cached: ReturnType<typeof normalize> | undefined
export function loadOCRSettings() { return cached ||= normalize(getLocalDataByKey(settingsKey)) }
function credentials(): Record<string, string> {
  return { ...getLocalDataByKey(credentialsKey) }
}
export function ocrSecret(ref: string) {
  const value = credentials()[ref]
  return typeof value === 'string' ? value : ''
}
function credentialStatus(ref: string) {
  const value = ocrSecret(ref)
  return { configured: !!value, maskedSuffix: value.slice(-4) }
}
function publicSettings() {
  const settings = loadOCRSettings()
  return { ...settings, credentials: Object.fromEntries([settings.mineru.credentialRef, settings.glmOcr.credentialRef].map(ref => [ref, credentialStatus(ref)])) }
}

export function ocrSettingsBridge(command: string, payload: any) {
  if (command === 'ocrListMistakeStudySets') {
    const sets = new Map<string, { id: string; title: string; mistakeCount: number }>()
    for (const record of Object.values(loadMistakeState().records)) {
      const id = record.sourceNotebookId
      const set = sets.get(id) || { id, title: record.sourceNotebookTitle, mistakeCount: 0 }
      set.mistakeCount++
      sets.set(id, set)
    }
    return [...sets.values()]
  }
  if (command === 'ocrGetSettings') return publicSettings()
  if (command === 'ocrSaveSettings') {
    const current = loadOCRSettings()
    const next = normalize({
      ocrEngine: payload.ocrEngine ?? current.ocrEngine,
      mineru: { ...current.mineru, baseUrl: payload.mineru?.baseUrl ?? current.mineru.baseUrl },
      glmOcr: { ...current.glmOcr, baseUrl: payload.glmOcr?.baseUrl ?? current.glmOcr.baseUrl },
    })
    setLocalDataByKey(next, settingsKey)
    cached = next
    return publicSettings()
  }
  if (command === 'ocrReadCredential' || command === 'ocrSetCredential' || command === 'ocrClearCredential') {
    const ref = String(payload.credentialRef || '')
    const settings = loadOCRSettings()
    if (![settings.mineru.credentialRef, settings.glmOcr.credentialRef].includes(ref)) throw new Error('凭据引用无效')
    if (command === 'ocrReadCredential') return { value: ocrSecret(ref) }
    const stored = credentials()
    const value = typeof payload.value === 'string' ? payload.value.trim() : ''
    if (command === 'ocrSetCredential' && value) stored[ref] = value
    else if (command === 'ocrClearCredential') delete stored[ref]
    else throw new Error('请输入 OCR 密钥')
    setLocalDataByKey(stored, credentialsKey)
    return credentialStatus(ref)
  }
}
