import { createContext, useContext, useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasMinRole } from '@accounting/shared';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';

/** Where to go once the document is saved. */
type SaveDestination = 'detail' | 'new' | 'close';
type SaveIntent = { post: boolean; then: SaveDestination };
/** Things that went wrong after the document itself was saved. */
export type SaveWarningState = { saveWarnings?: string[] } | null;

const PRIMARY_KEY = 'doc_primarySaveAction';

type Restart = (savedMessage: string) => void;
const RestartContext = createContext<Restart | null>(null);

/**
 * Wraps a "new document" form so "Save and new" can hand back a blank one:
 * bumping the key remounts the form with fresh state, and the confirmation of
 * what was just saved is shown above it.
 */
export function resettable<P extends object>(Form: ComponentType<P>): ComponentType<P> {
  return function ResettableForm(props: P) {
    const [round, setRound] = useState(0);
    const [saved, setSaved] = useState<string | null>(null);
    const restart: Restart = message => { setSaved(message); setRound(n => n + 1); };
    return (
      <RestartContext.Provider value={restart}>
        {saved && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
            {saved}
          </div>
        )}
        <Form key={round} {...props} />
      </RestartContext.Provider>
    );
  };
}

/**
 * QuickBooks-style saving for forms whose documents are created as drafts and
 * posted in a second step: Save and close / Save and new each save and post in
 * one go. Posting needs accountant access, so below that they save a draft.
 */
export function useSaveAndPost() {
  const intent = useRef<SaveIntent>({ post: true, then: 'detail' });
  const nav = useNavigate();
  const restart = useContext(RestartContext);
  const { user, businesses } = useAuth();
  const [businessId] = useActiveBusinessId();
  const role = businesses.find(b => b.id === businessId)?.role_override ?? user?.role;
  const canPost = role !== undefined && hasMinRole(role, 'accountant');

  /**
   * Call once the draft exists. Posts it (accountant and up), then goes where
   * the clicked button says. If the post (or an earlier after-save
   * step, passed as `warning`) failed, the saved draft is opened instead with
   * the reason shown -- staying on the form would invite a second click and a
   * duplicate.
   */
  async function finish(done: {
    /** POST here to post the draft. */
    postUrl: string;
    /** The saved document's own page. */
    detailPath: string;
    /** The list this kind of document lives in ("Save and close"). */
    listPath: string;
    /** What was saved, for the "Save and new" confirmation, e.g. "Expense". */
    label: string;
    warning?: string | null;
  }) {
    const saveWarnings = done.warning ? [done.warning] : [];
    const posting = canPost && intent.current.post;
    if (posting) {
      try {
        await api.post(done.postUrl);
      } catch (e: unknown) {
        saveWarnings.push(`Saved as a draft, but it could not be posted: ${pickErr(e)}`);
      }
    }
    if (saveWarnings.length > 0) {
      const state: SaveWarningState = { saveWarnings };
      nav(done.detailPath, { state });
      return;
    }
    const then = intent.current.then;
    if (then === 'new' && restart) restart(`${done.label} ${posting ? 'saved and posted' : 'saved as a draft'}.`);
    else if (then === 'close') nav(done.listPath);
    else nav(done.detailPath);
  }

  return { intent, canPost, finish };
}

/**
 * The submit button for such a form: [Save and close | v] with "Save and new"
 * under the arrow. It remembers which of the two was used last. A separate
 * "Save" and "Save draft" were dropped as repetitive (2026-10-04).
 */
export function SaveButtons({ save, busy }: { save: ReturnType<typeof useSaveAndPost>; busy: boolean }) {
  const [primary, setPrimary] = useState<'new' | 'close'>(
    () => (localStorage.getItem(PRIMARY_KEY) === 'new' ? 'new' : 'close'),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const other = primary === 'new' ? 'close' : 'new';
  const label = (action: 'new' | 'close') => (action === 'new' ? 'Save and new' : 'Save and close');
  // QuickBooks has no separate Post button: saving records the document. Say so on hover.
  const posts = save.canPost ? 'Saves and posts it to the books' : 'Saves it as a draft for an accountant to post';
  const hint = (action: 'new' | 'close') => (action === 'new'
    ? `${posts}, then opens a blank form for the next one`
    : `${posts}, then goes back to the list`);

  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpen]);

  const choose = (next: SaveIntent) => () => { save.intent.current = next; };

  return (
    <div className="flex flex-row-reverse items-center gap-2">
      <div className="relative flex" ref={menuRef}>
        <Button type="submit" disabled={busy} className="rounded-r-none" title={hint(primary)} onClick={choose({ post: true, then: primary })}>
          {busy ? 'Saving…' : label(primary)}
        </Button>
        <Button
          type="button"
          disabled={busy}
          aria-label="More save options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
          className="rounded-l-none border-l border-l-primary-foreground/30 px-2"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        {menuOpen && (
          <div role="menu" className="absolute bottom-full right-0 z-50 mb-1 w-44 rounded-md border bg-background py-1 shadow-lg">
            <button
              type="button"
              role="menuitem"
              className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent"
              title={hint(other)}
              onClick={e => {
                // Submitted by hand: closing the menu removes this button, and
                // a button that has left the page no longer submits its form.
                const form = e.currentTarget.form;
                save.intent.current = { post: true, then: other };
                localStorage.setItem(PRIMARY_KEY, other);
                setPrimary(other);
                setMenuOpen(false);
                form?.requestSubmit();
              }}
            >
              {label(other)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shown on the document page when it was saved but a follow-up step (posting, attaching) failed. */
export function PostErrorNotice({ className }: { className?: string }) {
  const warnings = (useLocation().state as SaveWarningState)?.saveWarnings;
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className={`rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 ${className ?? ''}`}>
      {warnings.map(warning => <p key={warning}>{warning}</p>)}
    </div>
  );
}
