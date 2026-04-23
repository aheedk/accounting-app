import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronRight,
  FileBarChart,
  LayoutDashboard,
  Package,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type NavChild = { to: string; label: string };
type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  children?: NavChild[];
};

const groups: NavGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart,
    children: [
      { to: '/reports/standard', label: 'Standard Reports' },
      { to: '/reports/custom', label: 'Custom Reports' },
      { to: '/reports/management', label: 'Management Reports' },
      { to: '/reports/performance', label: 'Performance Center' },
      { to: '/reports/financial-planning', label: 'Financial Planning' },
      { to: '/reports/spreadsheet-sync', label: 'Spreadsheet Sync' },
    ],
  },
  {
    id: 'ar',
    label: 'Accounts Receivable',
    icon: Users,
    children: [
      { to: '/customers', label: 'Customers' },
      { to: '/invoices', label: 'Invoices' },
      { to: '/payments', label: 'Payments' },
      { to: '/credit-memos', label: 'Credit Memos' },
      { to: '/reports/aging', label: 'Aging' },
    ],
  },
  {
    id: 'ap',
    label: 'Accounts Payable',
    icon: Wallet,
    children: [
      { to: '/ap/overview', label: 'Overview' },
      { to: '/ap/expenses', label: 'Expense Transactions' },
      { to: '/ap/vendors', label: 'Vendors' },
      { to: '/ap/bills', label: 'Bills' },
      { to: '/ap/bill-payments', label: 'Bill Payments' },
      { to: '/ap/contractors', label: 'Contractors' },
      { to: '/ap/1099s', label: '1099s' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    icon: BookOpen,
    children: [
      { to: '/accounting/client-overview', label: 'Client Overview' },
      { to: '/accounting/books-review', label: 'Books Review' },
      { to: '/accounting/bank-transactions', label: 'Bank Transactions' },
      { to: '/accounting/integrations', label: 'Integration Transactions' },
      { to: '/accounting/receipts', label: 'Receipts' },
      { to: '/accounting/reconcile', label: 'Reconcile' },
      { to: '/accounting/rules', label: 'Rules' },
      { to: '/settings/coa', label: 'Chart of Accounts' },
      { to: '/accounting/recurring', label: 'Recurring Transactions' },
      { to: '/accounting/fixed-assets', label: 'Fixed Assets' },
      { to: '/journal', label: 'Journal Entries' },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    icon: Settings,
    children: [
      { to: '/setup/entity', label: 'Entity' },
      { to: '/setup/coa', label: 'Chart of Accounts' },
      { to: '/setup/cost-centers', label: 'Cost Centers' },
      { to: '/setup/users', label: 'Users' },
      { to: '/settings/tax-codes', label: 'Tax Codes' },
      { to: '/settings/periods', label: 'Fiscal Periods' },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: Briefcase,
    children: [
      { to: '/payroll/overview', label: 'Overview' },
      { to: '/payroll/employees', label: 'Employees' },
      { to: '/payroll/contractors', label: 'Contractors' },
      { to: '/payroll/taxes', label: 'Payroll Taxes' },
      { to: '/payroll/compliance', label: 'Compliance' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Package,
    children: [
      { to: '/inventory/overview', label: 'Overview' },
      { to: '/inventory/items', label: 'Inventory' },
      { to: '/inventory/purchase-orders', label: 'Purchase Orders' },
      { to: '/inventory/item-receipts', label: 'Item Receipts' },
      { to: '/inventory/sales-orders', label: 'Sales Orders' },
      { to: '/inventory/shipping-labels', label: 'Shipping Labels' },
    ],
  },
];

const STORAGE_KEY = 'acct_sidebar_expanded';

function loadExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

function pathMatchesChild(pathname: string, child: NavChild): boolean {
  if (pathname === child.to) return true;
  // treat list roots as prefix matches for detail/new sub-routes
  return pathname.startsWith(child.to + '/');
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  const activeGroupId = useMemo(() => {
    for (const g of groups) {
      if (!g.children) continue;
      if (g.children.some(c => pathMatchesChild(pathname, c))) return g.id;
    }
    return null;
  }, [pathname]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => loadExpanded());

  // Auto-expand active group once, without collapsing user's manual choices.
  useEffect(() => {
    if (activeGroupId && !expanded[activeGroupId]) {
      setExpanded(prev => ({ ...prev, [activeGroupId]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
    } catch {
      /* ignore quota errors */
    }
  }, [expanded]);

  function toggle(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside className="w-64 shrink-0 border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <BookOpen className="h-4 w-4" />
        </div>
        <span className="font-semibold tracking-tight">Accounting</span>
      </div>

      <nav className="flex flex-col gap-0.5 p-3">
        {groups.map(group => {
          const Icon = group.icon;
          const isActiveGroup = activeGroupId === group.id;
          const isOpen = expanded[group.id] ?? isActiveGroup;

          if (!group.children || group.children.length === 0) {
            const to = group.to ?? '/';
            return (
              <NavLink
                key={group.id}
                to={to}
                end
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    isActive
                      ? 'border-l-2 border-primary bg-secondary text-secondary-foreground'
                      : 'text-foreground/80',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{group.label}</span>
              </NavLink>
            );
          }

          return (
            <div key={group.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggle(group.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(group.id);
                  }
                  if (e.key === 'ArrowRight' && !isOpen) toggle(group.id);
                  if (e.key === 'ArrowLeft' && isOpen) toggle(group.id);
                }}
                aria-expanded={isOpen}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActiveGroup
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-foreground/80',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{group.label}</span>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {isOpen && (
                <div className="mt-0.5 flex flex-col gap-0.5 pl-6">
                  {group.children.map(child => {
                    const childActive = pathMatchesChild(pathname, child);
                    return (
                      <button
                        key={`${group.id}-${child.to}`}
                        type="button"
                        onClick={() => navigate(child.to)}
                        className={cn(
                          'flex items-center rounded-md border-l-2 px-3 py-1.5 text-left text-sm transition-colors',
                          childActive
                            ? 'border-primary bg-secondary font-medium text-secondary-foreground'
                            : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        {child.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
