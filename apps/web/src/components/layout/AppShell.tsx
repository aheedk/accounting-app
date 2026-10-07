import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { TopBar } from './TopBar';
import { CompanySwitchedScreen } from './CompanySwitchedScreen';
import { useActiveBusinessId, useCompanySwitchedElsewhere } from '@/lib/business';
import { setExportCompany } from '@/lib/reportExport';
import { useAuth } from '@/auth/useAuth';

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the drawer if the viewport grows to the `lg` breakpoint, where the
  // static sidebar takes over — avoids the drawer lingering over it on resize.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Exports and printed reports are headed with the company whose books are open.
  const { businesses } = useAuth();
  const [activeBusinessId] = useActiveBusinessId();
  const activeBusinessName = businesses.find(b => b.id === activeBusinessId)?.name ?? '';
  useEffect(() => { setExportCompany(activeBusinessName); }, [activeBusinessName]);

  // Another tab switched company: replace the page outright, so nothing from
  // the old company stays on screen or stays clickable.
  const switchedTo = useCompanySwitchedElsewhere();
  if (switchedTo) return <CompanySwitchedScreen businessId={switchedTo} />;

  return (
    // print:* — on paper there is no sidebar or top bar, and the page is as tall as its content.
    <div className="flex h-screen overflow-hidden bg-background text-foreground print:block print:h-auto print:overflow-visible">
      <div className="contents print:hidden">
        <Sidebar />
        <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="contents print:hidden">
          <TopBar onMenuClick={() => setMobileNavOpen(true)} />
        </div>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
