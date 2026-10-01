import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { TopBar } from './TopBar';
import { CompanySwitchedScreen } from './CompanySwitchedScreen';
import { useCompanySwitchedElsewhere } from '@/lib/business';

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

  // Another tab switched company: replace the page outright, so nothing from
  // the old company stays on screen or stays clickable.
  const switchedTo = useCompanySwitchedElsewhere();
  if (switchedTo) return <CompanySwitchedScreen businessId={switchedTo} />;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
