import { ChatShell } from "./components/chat/chat-shell"
import "./ui/agent-panel.css"

export function AgentPanel({ onOpenSettings }) {
  return <ChatShell onOpenSettings={onOpenSettings} />
}
