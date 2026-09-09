import { loadMatcherSettings, saveMatcherSettings } from "./settings"
import { hideAnswerToolbar } from "./floating-toolbar"

// 普通 JS 服务，不经 JSExtension 自定义 selector 往返传递 boolean。
export function isCardToolbarEnabled(): boolean {
  return loadMatcherSettings().cardToolbarEnabled
}

export function setCardToolbarEnabled(enabled: boolean, owner: any = self): { enabled: boolean } {
  const next = enabled === true
  saveMatcherSettings({ cardToolbarEnabled: next })
  if (!next) hideAnswerToolbar(owner)
  return { enabled: next }
}
