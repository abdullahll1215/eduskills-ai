import { Bot, Loader2, Send, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { Alert, PageHeader, useFetch } from "../../components/ui";

interface Msg {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = ["Which skill should I improve first?", "How is my blind spot calculated?", "What are my strengths?", "Recommend resources for me", "ما هي أكبر فجوة لدي؟"];

export default function Coach() {
  const { data, error, setData } = useFetch(() => api<Msg[]>("/api/chat"));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = data ?? [];

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages.length]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    setData([...messages, { role: "user", content: text }]);
    setBusy(true);
    try {
      const reply = await api<Msg>("/api/chat", { body: { message: text } });
      setData((prev) => [...(prev ?? []), reply]);
    } catch (e) {
      setData((prev) => [...(prev ?? []), { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const clear = async () => {
    if (!confirm("Delete your chat history?")) return;
    await api("/api/chat", { method: "DELETE" });
    setData([]);
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <PageHeader
        title="AI Coach"
        subtitle="Ask questions about your feedback and get real-time advice. Your chat history is archived for your reference."
        actions={messages.length > 0 && <button className="btn-ghost" onClick={clear}><Trash2 className="h-4 w-4" /> Clear history</button>}
      />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="card flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Bot className="h-10 w-10 text-brand-500" />
              <div className="mt-2 font-semibold text-slate-800">Hi! I'm your EduSkills coach.</div>
              <div className="text-sm text-slate-500">I can explain your scores, blind spots and suggest next steps. Arabic and English are supported.</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id ?? i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                dir="auto"
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"}`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Thinking...</div>
          )}
          <div ref={bottom} />
        </div>
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50" dir="auto">{s}</button>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2">
            <input className="input" dir="auto" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your feedback..." />
            <button className="btn-primary" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      </div>
    </div>
  );
}
