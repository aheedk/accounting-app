import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Clock, Sparkles } from 'lucide-react';
import type { schemas } from '@accounting/shared';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { chatActionRoute, chatActionLabel } from '@/lib/chatActionMappers';
import { fmtMoney } from '@/lib/money';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action?: schemas.ChatActionPayload;
  data?: Record<string, unknown>[];
};

type Conversation = { id: string; title: string; updated_at: string };

type ApiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action_payload: schemas.ChatActionPayload | null;
};

/** Everything the chat `action` draft needs to pre-fill the real create page it
 * hands off to — the page reads this from `location.state.chatDraft`. */
export type ChatDraftState = { chatDraft: schemas.ChatActionPayload };

const SUGGESTIONS = [
  "What's our AR balance?",
  'Create a $500 rent expense from checking',
  'How do I reconcile a bank account?',
];

function ActionCard({ action, note }: { action: schemas.ChatActionPayload; note?: string }) {
  const nav = useNavigate();
  const lines: { label: string; amount: string }[] = (() => {
    switch (action.type) {
      case 'journal_entry':
        return action.data.lines.map(l => ({
          label: `${l.account_name || 'Unmatched account'}${l.description ? ` — ${l.description}` : ''}`,
          amount: l.debit ? `Dr ${fmtMoney(l.debit)}` : `Cr ${fmtMoney(l.credit ?? 0)}`,
        }));
      case 'expense':
        return action.data.lines.map(l => ({ label: `${l.account_name || 'Unmatched account'}${l.description ? ` — ${l.description}` : ''}`, amount: fmtMoney(l.amount) }));
      case 'deposit':
        return action.data.lines.map(l => ({ label: `${l.account_name || 'Unmatched account'}${l.description ? ` — ${l.description}` : ''}`, amount: fmtMoney(l.amount) }));
      case 'invoice':
        return action.data.lines.map(l => ({ label: l.description, amount: fmtMoney(Number(l.quantity) * Number(l.unit_price)) }));
    }
  })();
  const openPrefilled = () => nav(chatActionRoute(action), { state: { chatDraft: action } satisfies ChatDraftState });
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{chatActionLabel(action)} — draft</span>
        <span className="text-xs text-muted-foreground">
          {action.type === 'invoice' ? action.data.customer_name : action.type === 'expense' ? action.data.vendor_name : ''}
        </span>
      </div>
      <ul className="space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">{l.label}</span>
            <span className="shrink-0 font-mono tabular-nums">{l.amount}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}
      <button
        type="button"
        onClick={openPrefilled}
        className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover active:translate-y-px"
      >
        Open prefilled {chatActionLabel(action).toLowerCase()} form →
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">Nothing is saved until you review and submit that form.</p>
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0]!);
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50"><tr>{columns.map(c => <th key={c} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 20).map((row, i) => (
            <tr key={i} className="border-t border-border">{columns.map(c => <td key={c} className="px-2.5 py-1.5 font-mono tabular-nums">{String(row[c] ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">+{rows.length - 20} more rows</p>}
    </div>
  );
}

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [bizId] = useActiveBusinessId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  function loadHistoryList() {
    if (!bizId) return;
    api.get<{ conversations: Conversation[] }>(`/businesses/${bizId}/chat/conversations`)
      .then(r => setConversations(r.data.conversations))
      .catch(() => setConversations([]));
  }

  function openConversation(id: string) {
    if (!bizId) return;
    setHistoryOpen(false);
    setErr(null);
    api.get<{ messages: ApiMessage[] }>(`/businesses/${bizId}/chat/conversations/${id}/messages`)
      .then(r => {
        setConversationId(id);
        setMessages(r.data.messages.map(m => ({ id: m.id, role: m.role, content: m.content, ...(m.action_payload ? { action: m.action_payload } : {}) })));
      })
      .catch(e => setErr(pickErr(e)));
  }

  function startNewChat() {
    setConversationId(undefined);
    setMessages([]);
    setErr(null);
    setHistoryOpen(false);
  }

  async function sendText(text: string) {
    if (!text || !bizId || busy) return;
    setInput('');
    setErr(null);
    const userMsg: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; conversationId: string; action?: schemas.ChatActionPayload; data?: Record<string, unknown>[] }>(
        `/businesses/${bizId}/chat`,
        { message: text, ...(conversationId ? { conversationId } : {}) },
      );
      setConversationId(r.data.conversationId);
      setMessages(prev => [...prev, {
        id: `local-${Date.now()}-a`,
        role: 'assistant',
        content: r.data.reply,
        ...(r.data.action ? { action: r.data.action } : {}),
        ...(r.data.data ? { data: r.data.data } : {}),
      }]);
    } catch (e) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        'fixed inset-0 z-40 flex flex-col overflow-hidden rounded-none border border-border bg-background shadow-2xl ' +
        'transition-all duration-150 ease-out ' +
        'sm:inset-auto sm:bottom-20 sm:right-6 sm:h-[560px] sm:max-h-[calc(100vh-120px)] sm:w-[400px] sm:rounded-2xl ' +
        (open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0')
      }
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label="Ask Accmatica"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-4">
        <h2 className="text-[18px] font-semibold">Ask Accmatica</h2>
        <div className="flex items-center gap-3">
          <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) loadHistoryList(); }}>History</button>
          <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={startNewChat}>New chat</button>
          <button type="button" aria-label="Close chat" className="text-lg leading-none text-muted-foreground hover:text-foreground" onClick={onClose}>×</button>
        </div>
      </div>

      {historyOpen && (
        <div className="max-h-48 overflow-y-auto border-b border-border bg-muted/30 text-sm">
          {conversations.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <p className="text-muted-foreground">Your conversations will appear here</p>
            </div>
          )}
          {conversations.map(c => (
            <button key={c.id} type="button" onClick={() => openConversation(c.id)} className="block w-full truncate px-4 py-2 text-left hover:bg-accent">
              {c.title}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="scroll-smooth flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask about your numbers, ask for a draft transaction, or ask for help using Accmatica.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void sendText(s)}
                  className="rounded-full border border-border bg-muted px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(m => m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-[14px] text-primary-foreground">
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 text-[14px] text-foreground">
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.action && <ActionCard action={m.action} />}
              {m.data && <DataTable rows={m.data} />}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <LoadingIndicator size="sm" />
          </div>
        )}
      </div>

      {err && <p className="border-t border-border px-4 py-2 text-sm text-destructive">{err}</p>}

      <form
        className="border-t border-border p-3"
        onSubmit={e => { e.preventDefault(); void sendText(input.trim()); }}
      >
        <div className="relative">
          <textarea
            className="w-full resize-none rounded-xl border border-border bg-muted px-3.5 py-2.5 pr-11 text-[14px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring"
            rows={2}
            placeholder="Ask a question or describe a transaction…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(input.trim()); } }}
            disabled={busy || !bizId}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || !input.trim() || !bizId}
            className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
