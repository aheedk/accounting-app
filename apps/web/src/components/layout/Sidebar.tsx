import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard' },
  // Plan 1.1 adds: Journal, COA, Periods
  // Plan 1.2 adds: Customers, Invoices, Payments, Credit Memos, Aging
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-card p-4">
      <div className="font-semibold mb-4">Accounting</div>
      <nav className="flex flex-col gap-1">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn(
              'rounded px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
              isActive && 'bg-accent text-accent-foreground'
            )}
            end
          >{item.label}</NavLink>
        ))}
      </nav>
    </aside>
  );
}
