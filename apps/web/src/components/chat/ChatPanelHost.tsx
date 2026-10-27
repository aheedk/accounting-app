import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { useEffectiveRole } from '@/lib/roleAccess';
import { ChatPanel } from './ChatPanel';

/**
 * Mounted once at the app root (see App.tsx), as a sibling of the page
 * router — not inside AppShell's layout tree — so it floats over every page
 * instead of taking part in any flex layout that could shrink the main
 * content column, and so it is never unmounted/remounted by route changes.
 *
 * Hidden for `client` (chat isn't in clientAccess.ts's allow-list — the API
 * would 403 every call), `viewer` (the POST route's own `refuseViewOnly`
 * blocks every message, every intent), signed-out visitors, and when no
 * business is open yet (chat is scoped to one business's books).
 *
 * `mounted` stays true forever once the panel is first opened, even while
 * closed — unmounting it would throw away the in-progress conversation.
 * Visibility after that is a CSS transition inside ChatPanel, not
 * conditional rendering.
 */
export function ChatPanelHost() {
  const { user } = useAuth();
  const [bizId] = useActiveBusinessId();
  const role = useEffectiveRole();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // One pulse to draw the eye on first load — this component mounts once
  // per page load (root-level, never remounted by navigation), so plain
  // local state is enough; no need to persist it anywhere.
  const [showPulse, setShowPulse] = useState(true);

  if (!user || !bizId || role === 'client' || role === 'viewer') return null;

  function toggle() {
    setMounted(true);
    setOpen(o => !o);
  }

  return (
    <>
      <button
        type="button"
        aria-label={open ? 'Close Accmatica chat' : 'Ask Accmatica'}
        onClick={toggle}
        onAnimationEnd={() => setShowPulse(false)}
        className={
          'fixed bottom-6 right-6 z-[51] flex h-14 w-14 items-center justify-center rounded-full ' +
          'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl ' +
          'transition-transform hover:scale-105 active:translate-y-px print:hidden ' +
          (!open && showPulse ? 'chat-bubble-pulse' : '')
        }
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-6 w-6" />}
      </button>
      {mounted && <ChatPanel open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
