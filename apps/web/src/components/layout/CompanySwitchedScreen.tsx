import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';

/**
 * Shown in place of the app when another tab of this browser has switched to a
 * different company. Only one company can be current per browser, so this tab
 * either reloads into that company or gets closed.
 */
export function CompanySwitchedScreen({ businessId }: { businessId: string }) {
  const { businesses } = useAuth();
  const name = businesses.find(b => b.id === businessId)?.name ?? 'another company';

  return (
    <div className="flex h-screen items-center justify-center bg-sidebar p-4">
      <div role="alertdialog" aria-labelledby="company-switched-title" className="w-full max-w-lg rounded-lg bg-background p-8 shadow-xl">
        <h1 id="company-switched-title" className="text-2xl font-semibold">What happened to this page?</h1>
        <p className="mt-5 text-sm">
          To help protect your books, only one company can be open at a time in this browser.
          Another tab switched to <span className="font-semibold">{name}</span>, so this page was closed.
        </p>
        <p className="mt-3 text-sm">Do one of the following:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
          <li>Continue here with {name}</li>
          <li>Close this tab</li>
        </ul>
        {/* A full load, not a route change: nothing from the old company may survive in memory. */}
        <Button className="mt-6" onClick={() => window.location.assign('/')}>Open {name}</Button>
        <p className="mt-6 text-xs text-muted-foreground">
          <span className="font-semibold">Tip:</span> to work in two companies at the same time, use two different
          browsers, like Chrome and Edge.
        </p>
      </div>
    </div>
  );
}
