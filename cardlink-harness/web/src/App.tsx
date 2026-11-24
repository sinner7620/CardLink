import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Input, Label, Separator, Textarea } from "@/components/ui/primitives";

type AgentMessageDto = {
  type: "user" | "assistant" | "tool_result";
  id: string;
  text?: string;
  content?: unknown;
  toolCalls?: Array<{ id: string; name: string; arguments?: unknown }>;
  status?: string;
  createdAt: string;
};

type SessionDto = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessageDto[];
  scope: { notebookIds: string[]; subject?: string };
};

type TurnResult = {
  status: "completed" | "limit_reached" | "error";
  message?: string;
  evidenceRefs?: string[];
  warnings?: Array<{ code: string; detail: string }>;
  error?: { code: string; message: string };
};

type Stats = {
  totalMistakes: number;
  levelCounts: Record<string, number>;
  dueCount: number;
  reviewedCount: number;
  reviewEventCount: number;
  snapshotId: string;
  params: { statsTime: string; timezone: string; dueBoundary: string };
};

const TOKEN_KEY = "h1.http.token";

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenDraft, setTokenDraft] = useState(token);
  const [sessions, setSessions] = useState<Array<Pick<SessionDto, "id" | "status" | "createdAt">>>([]);
  const [activeSession, setActiveSession] = useState<SessionDto | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notebooksDraft, setNotebooksDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const authed = token.trim().length > 0;

  const refreshSessions = useCallback(async () => {
    if (!authed) return;
    try {
      const data = await api<{ sessions: Array<Pick<SessionDto, "id" | "status" | "createdAt">> }>("/h1/sessions?limit=50", token);
      setSessions(data.sessions);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [authed, token]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages.length]);

  const openSession = async (id: string) => {
    setError(null);
    try {
      const session = await api<SessionDto>(`/h1/sessions/${id}`, token);
      setActiveSession(session);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const createSession = async () => {
    setError(null);
    setBusy(true);
    try {
      const notebookIds = notebooksDraft.split(",").map((x) => x.trim()).filter(Boolean);
      const { sessionId } = await api<{ sessionId: string }>("/h1/sessions", token, {
        method: "POST",
        body: JSON.stringify({ scope: { notebookIds } }),
      });
      await refreshSessions();
      await openSession(sessionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!activeSession || !draft.trim() || !authed) return;
    setError(null);
    setBusy(true);
    const text = draft.trim();
    setDraft("");
    try {
      const result = await api<TurnResult>(`/h1/sessions/${activeSession.id}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ requestId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text }),
      });
      if (result.status === "error") setError(result.error?.message ?? "未知错误");
      await openSession(activeSession.id);
      await refreshSessions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">CardLink Harness H1</h1>
          <p className="text-xs text-muted-foreground">错题只读分析 Agent（G1–G7 · 规范 v1.3）</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="token">会话令牌</Label>
            <Input
              id="token"
              type="password"
              value={tokenDraft}
              placeholder="H1_HTTP_TOKEN"
              onChange={(e) => setTokenDraft(e.target.value)}
              className="w-56"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setToken(tokenDraft.trim());
              localStorage.setItem(TOKEN_KEY, tokenDraft.trim());
              void refreshSessions();
            }}
          >
            保存
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-3">
        <div className="flex min-h-0 flex-col gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">新建会话</CardTitle>
              <CardDescription className="text-xs">笔记本 ID 以逗号分隔；留空 = 全部</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                value={notebooksDraft}
                placeholder="notebookId1, notebookId2"
                onChange={(e) => setNotebooksDraft(e.target.value)}
              />
              <Button className="w-full" size="sm" disabled={busy || !authed} onClick={() => void createSession()}>
                创建会话
              </Button>
            </CardContent>
          </Card>

          <Card className="min-h-0 flex-1 overflow-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">会话列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {sessions.length === 0 && <p className="text-xs text-muted-foreground">暂无会话</p>}
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => void openSession(s.id)}
                >
                  <span className="font-mono">{s.id.slice(0, 8)}…</span>
                  <Badge variant={s.status === "completed" ? "secondary" : s.status === "error" ? "destructive" : "outline"} className="ml-2">
                    {s.status}
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {activeSession ? `会话 ${activeSession.id.slice(0, 8)}…（${activeSession.status}）` : "选择或新建会话"}
            </CardTitle>
            {activeSession && (
              <CardDescription className="text-xs">
                授权范围：{activeSession.scope.notebookIds.length ? activeSession.scope.notebookIds.join(", ") : "全部笔记本"}
              </CardDescription>
            )}
          </CardHeader>
          <Separator />
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-auto pt-4">
            {!activeSession && <p className="text-sm text-muted-foreground">左侧选择会话，或新建一个。</p>}
            {activeSession?.messages.map((m) =>
              m.type === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
                    {m.text}
                  </div>
                </div>
              ) : m.type === "assistant" ? (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.text}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {m.toolCalls.map((tc) => (
                          <div key={tc.id} className="text-xs text-muted-foreground">
                            <Badge variant="outline">工具</Badge> <span className="font-mono">{tc.name}</span>
                            <code className="ml-1">{JSON.stringify(tc.arguments ?? {})}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <details key={m.id} className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    工具结果 <Badge variant="outline">{m.status}</Badge>
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto text-[11px] leading-4">{JSON.stringify(m.content, null, 2)}</pre>
                </details>
              ),
            )}
            <div ref={bottomRef} />
          </CardContent>
          <Separator />
          <CardContent className="pt-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                placeholder={authed ? "询问错题统计或具体错题…" : "请先在右上角填入会话令牌"}
                disabled={!activeSession || busy || !authed}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button disabled={!activeSession || busy || !draft.trim() || !authed} onClick={() => void send()}>
                发送
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
