import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { pickErr } from '@/lib/apiErrors';
import { fmtDateTime } from '@/lib/dates';
import { roleLabel, useEffectiveRole } from '@/lib/roleAccess';
import { announceMessagesRead } from '@/lib/useUnreadMessages';
import type { Role } from '@/auth/AuthContext';

type Message = { id: string; body: string; created_at: string; author_name: string; author_role: Role; mine: boolean };
type Page = { messages: Message[]; has_more: boolean };

const PAGE_SIZE = 50;
const REFRESH_MS = 30_000;

// One thread per company, between the client and the firm. Every role can read
// it; everyone but a view-only login can write.
export default function MessagesPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const role = useEffectiveRole();
  const canWrite = role !== null && role !== 'viewer';
  const company = businesses.find(b => b.id === bizId)?.name ?? 'this company';

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const markRead = useCallback(() => {
    if (!bizId) return;
    api.post(`/businesses/${bizId}/messages/read`, {}).then(announceMessagesRead).catch(() => undefined);
  }, [bizId]);

  // The newest page. Called on opening, after sending, and every so often for replies.
  const loadLatest = useCallback(async (scroll: boolean) => {
    if (!bizId) return;
    try {
      const r = await api.get<Page>(`/businesses/${bizId}/messages`, { params: { limit: PAGE_SIZE } });
      setMessages(current => {
        // Keep any earlier messages already paged in above the newest page.
        const firstNew = r.data.messages[0]?.created_at;
        const earlier = firstNew ? current.filter(m => m.created_at < firstNew) : [];
        return [...earlier, ...r.data.messages];
      });
      setHasMore(current => current || r.data.has_more);
      setErr(null);
      markRead();
      if (scroll) setTimeout(() => bottom.current?.scrollIntoView({ block: 'end' }), 0);
    } catch (e: unknown) { setErr(pickErr(e)); }
  }, [bizId, markRead]);

  useEffect(() => {
    setMessages([]); setHasMore(false);
    void loadLatest(true);
    const timer = setInterval(() => void loadLatest(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadLatest]);

  async function loadEarlier() {
    const first = messages[0];
    if (!bizId || !first) return;
    try {
      const r = await api.get<Page>(`/businesses/${bizId}/messages`, { params: { limit: PAGE_SIZE, before: first.created_at } });
      setMessages(current => [...r.data.messages, ...current]);
      setHasMore(r.data.has_more);
    } catch (e: unknown) { setErr(pickErr(e)); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !draft.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/messages`, { body: draft });
      setDraft('');
      await loadLatest(true);
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {role === 'client'
            ? 'Write to your accountant here. They see it the next time they open your books.'
            : `The thread with ${company}. The client and everyone at the firm with access to this company can read it.`}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          {hasMore && (
            <div className="text-center">
              <Button variant="ghost" size="sm" onClick={() => void loadEarlier()}>Show earlier messages</Button>
            </div>
          )}
          {messages.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>}
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                <div className={`mb-0.5 text-xs ${m.mine ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                  {m.mine ? 'You' : `${m.author_name} · ${roleLabel(m.author_role)}`} · {fmtDateTime(m.created_at)}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {canWrite ? (
        <form className="flex flex-col gap-2" onSubmit={send}>
          <textarea
            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Write a message…" maxLength={5000} aria-label="Message"
            value={draft} onChange={e => setDraft(e.target.value)}
          />
          <div><Button type="submit" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send'}</Button></div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">A view-only login can read the thread and cannot write to it.</p>
      )}
    </div>
  );
}
