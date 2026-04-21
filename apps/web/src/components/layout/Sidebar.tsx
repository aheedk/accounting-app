import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/payments', label: 'Payments' },
  { to: '/credit-memos', label: 'Credit Memos' },
  { to: '/journal', label: 'Journal Entries' },
  { to: '/reports/trial-balance', label: 'Trial Balance' },
  { to: '/reports/aging', label: 'AR Aging' },
  { to: '/settings/coa', label: 'Chart of Accounts' },
  { to: '/settings/tax-codes', label: 'Tax Codes' },
  { to: '/settings/periods', label: 'Fiscal Periods' },
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-card p-4">
      <div className="font-semibold mb-4">Accounting</div>
      <nav className="flex flex-col gap-1">
        {items.map(item => (
          <NavLink key={item.to} to={item.to} end className={({ isActive }) => cn(
            'rounded px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
            isActive && 'bg-accent text-accent-foreground',
          )}>{item.label}</NavLink>
        ))}
      </nav>
    </aside>
  );
}
