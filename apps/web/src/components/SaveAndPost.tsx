import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasMinRole } from '@accounting/shared';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';

type SaveIntent = 'draft' | 'post';
type PostErrorState = { postError?: string } | null;

/**
 * One-click "Save and post" for forms whose documents are created as drafts
 * and posted in a second step. Posting needs accountant access, so anyone
 * below that only gets "Save draft".
 */
export function useSaveAndPost() {
  const intent = useRef<SaveIntent>('draft');
  const nav = useNavigate();
  const { user, businesses } = useAuth();
  const [businessId] = useActiveBusinessId();
  const role = businesses.find(b => b.id === businessId)?.role_override ?? user?.role;
  const canPost = role !== undefined && hasMinRole(role, 'accountant');

  /**
   * Call once the draft exists. Posts it when "Save and post" was clicked,
   * then opens it. A failed post still opens the saved draft -- staying on the
   * form would invite a second click and a duplicate -- and carries the reason
   * along for PostErrorNotice.
   */
  async function finish(postUrl: string, detailPath: string) {
    if (canPost && intent.current === 'post') {
      try {
        await api.post(postUrl);
      } catch (e: unknown) {
        const state: PostErrorState = { postError: pickErr(e) };
        nav(detailPath, { state });
        return;
      }
    }
    nav(detailPath);
  }

  return { intent, canPost, finish };
}

/**
 * The submit buttons for such a form. "Save and post" comes first in the DOM
 * (shown last via row-reverse) so pressing Enter in a field uses it.
 */
export function SaveButtons({ save, busy }: { save: ReturnType<typeof useSaveAndPost>; busy: boolean }) {
  return (
    <div className="flex flex-row-reverse gap-2">
      {save.canPost && (
        <Button type="submit" disabled={busy} onClick={() => { save.intent.current = 'post'; }}>
          {busy && save.intent.current === 'post' ? 'Saving…' : 'Save and post'}
        </Button>
      )}
      <Button
        type="submit"
        variant={save.canPost ? 'outline' : 'default'}
        disabled={busy}
        onClick={() => { save.intent.current = 'draft'; }}
      >
        {busy && save.intent.current === 'draft' ? 'Saving…' : 'Save draft'}
      </Button>
    </div>
  );
}

/** Shown on the document page when it was saved but the post step failed. */
export function PostErrorNotice() {
  const postError = (useLocation().state as PostErrorState)?.postError;
  if (!postError) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      Saved as a draft, but it could not be posted: {postError}
    </div>
  );
}
