import { select } from 'marginnote'

export interface ErrorReason { key: string; label: string }
export const DEFAULT_ERROR_REASONS: ErrorReason[] = [
  { key: 'concept', label: '概念不清' }, { key: 'formula', label: '公式遗忘' },
  { key: 'approach', label: '思路受阻' }, { key: 'calculation', label: '计算失误' },
  { key: 'reading', label: '审题遗漏' }, { key: 'time', label: '时间不足' }
]

export async function chooseErrorReason(level: number, reasons = DEFAULT_ERROR_REASONS): Promise<{ cancelled?: boolean; reason?: ErrorReason }> {
  if (level !== 0 && level !== 1) return {}
  const options = reasons.filter(r => r && typeof r.key === 'string' && !!r.key && typeof r.label === 'string' && !!r.label)
  if (!options.length) return {}
  const choice = await select([...options.map(r => r.label), '跳过错因并保存'], '本次错因', '选择一项主要错因；取消则不提交本次等级', true)
  if (choice.index < 0 || choice.index > options.length) return { cancelled: true }
  return choice.index === options.length ? {} : { reason: { ...options[choice.index] } }
}
