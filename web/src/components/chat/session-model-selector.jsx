import { useState } from "react"
import {
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorRoot,
  ModelSelectorSearch,
  ModelSelectorTrigger,
  ModelSelectorValue,
} from "@/components/assistant-ui/elements/model-selector"
import { ReasoningEffort } from "@/components/assistant-ui/elements/reasoning-effort"
import { Button } from "@/components/ui/button"
import { harnessSend } from "../../lib/harnessClient"

function modelKey(setting) {
  return setting ? JSON.stringify([setting.providerId, setting.model]) : undefined
}

export function SessionModelSelector({ chat }) {
  const [settings, setSettings] = useState(null)
  const [catalogs, setCatalogs] = useState({})
  const [pending, setPending] = useState("")
  const [error, setError] = useState("")
  const selected = chat.sessionModel
  const connections = settings?.connections?.filter((item) =>
    item.enabled && item.keySet && item.authorizedRoles?.includes("assistant")) ?? []
  const options = new Map()
  const addModel = (setting, connection) => {
    if (!setting?.model) return
    options.set(modelKey(setting), {
      id: modelKey(setting),
      name: setting.model,
      description: connection?.baseUrl,
      providerId: setting.providerId,
      model: setting.model,
    })
  }
  if (selected) addModel(selected, connections.find((item) => item.id === selected.providerId))
  for (const connection of connections) {
    for (const role of ["assistant", "reviewer"]) {
      if (settings?.[role]?.providerId === connection.id) addModel(settings[role], connection)
    }
    for (const item of catalogs[connection.id] ?? []) addModel({ providerId: connection.id, model: item.id }, connection)
  }

  async function loadSettings(open) {
    if (!open) return
    setError("")
    setPending("settings")
    try {
      const res = await harnessSend("harness.getModelSettings")
      if (!res?.ok) throw new Error(res?.error?.message || "读取已授权连接失败")
      setSettings(res.data)
      setCatalogs({})
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending("")
    }
  }

  async function loadCatalog(providerId) {
    setError("")
    setPending(providerId)
    try {
      const res = await harnessSend("harness.listProviderModels", { providerId })
      if (!res?.ok) throw new Error(res?.error?.message || "读取模型目录失败")
      setCatalogs((current) => ({ ...current, [providerId]: res.data.models }))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending("")
    }
  }

  return (
    <ModelSelectorRoot
      models={[...options.values()]}
      value={modelKey(selected) ?? ""}
      onOpenChange={loadSettings}
      onValueChange={(key) => {
        const choice = options.get(key)
        if (choice && key !== modelKey(selected)) void chat.switchSessionModel(choice.providerId, choice.model)
      }}
    >
      <ModelSelectorTrigger aria-label="会话模型" variant="ghost" size="sm" className="max-w-36 shrink-0"
        disabled={!chat.activeSessionId || chat.running || chat.pendingQuestion || chat.sessionLoading || chat.modelBusy}>
        <ModelSelectorValue placeholder="会话模型" />
      </ModelSelectorTrigger>
      <ModelSelectorContent align="start">
        <ModelSelectorSearch placeholder="搜索模型" />
        <ModelSelectorList>
          <ModelSelectorEmpty>{pending ? "正在读取…" : "暂无可选模型"}</ModelSelectorEmpty>
          {[...options.values()].map((item) => <ModelSelectorItem key={item.id} model={item} />)}
        </ModelSelectorList>
        {connections.length ? (
          <div className="flex flex-col gap-1 border-t p-1.5">
            {connections.map((item) => (
              <Button key={item.id} variant="ghost" size="sm" className="justify-start truncate" type="button"
                disabled={Boolean(pending)} onClick={() => { void loadCatalog(item.id) }}>
                {pending === item.id ? "正在读取…" : "获取模型目录"} · {item.baseUrl}
              </Button>
            ))}
          </div>
        ) : null}
        {selected?.availableEfforts?.length ? (
          <ReasoningEffort className="border-t p-2"
            levels={selected.availableEfforts.map((key) => ({ key, label: ({ low: "低", high: "高", max: "最高" })[key] }))}
            selectedKey={selected.availableEfforts.includes(selected.effort) ? selected.effort : "low"}
            onSelect={chat.modelBusy ? undefined : (effort) => { void chat.switchSessionModel(selected.providerId, selected.model, effort) }} />
        ) : null}
        {error ? <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p> : null}
      </ModelSelectorContent>
    </ModelSelectorRoot>
  )
}
