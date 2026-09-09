import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BookOpen,
  Briefcase,
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
import { MyMenu } from './MyMenu';
import { CreateMenu } from './CreateMenu';
import { BookmarkMenu } from './BookmarkMenu';
import { JOURNAL_NAV_ITEM } from '@/pages/journal/journalNavigation';

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
      { to: '/ap/vendor-credits', label: 'Vendor Credits' },
      { to: '/ap/contractors', label: 'Contractors' },
      { to: '/reports/1099', label: '1099s' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    icon: BookOpen,
    children: [
      { to: '/accounting/client-overview', label: 'Client Overview' },
      { to: '/accounting/books-review', label: 'Books Review' },
      { to: '/accounting/bank-accounts', label: 'Bank Accounts' },
      { to: '/accounting/bank-transactions', label: 'Bank Transactions' },
      { to: '/accounting/email-imports', label: 'Email Import Review' },
      { to: '/accounting/integrations', label: 'Integration Transactions' },
      { to: '/accounting/receipts', label: 'Receipts' },
      { to: '/accounting/reconcile', label: 'Reconcile' },
      { to: '/accounting/rules', label: 'Rules' },
      { to: '/settings/coa', label: 'Chart of Accounts' },
      { to: '/accounting/recurring', label: 'Recurring Transactions' },
      { to: '/accounting/fixed-assets', label: 'Fixed Assets' },
      { to: JOURNAL_NAV_ITEM.path, label: 'Journal Entries' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart,
    children: [
      { to: '/reports/standard', label: 'Standard Reports' },
      { to: '/reports/pnl', label: 'Profit & Loss' },
      { to: '/reports/balance-sheet', label: 'Balance Sheet' },
      { to: '/reports/general-ledger', label: 'General Ledger' },
      { to: '/reports/cash-flow', label: 'Cash Flow' },
      { to: '/reports/custom', label: 'Custom Reports' },
      { to: '/reports/management', label: 'Management Reports' },
      { to: '/reports/performance', label: 'Performance Center' },
      { to: '/reports/financial-planning', label: 'Financial Planning' },
      { to: '/reports/spreadsheet-sync', label: 'Spreadsheet Sync' },
      { to: '/reports/trial-balance', label: 'Trial Balance' },
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
];

function pathMatchesChild(pathname: string, child: NavChild): boolean {
  if (pathname === child.to) return true;
  // treat list roots as prefix matches for detail/new sub-routes
  return pathname.startsWith(child.to + '/');
}

// Brand header shared by the desktop sidebar and the mobile drawer.
export function SidebarBrand() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gold/90 text-sidebar">
        <BookOpen className="h-4 w-4" />
      </div>
      <span className="font-display text-lg tracking-tight text-white">Accounting</span>
    </div>
  );
}

type SidebarNavProps = {
  // Desktop expands a group on hover; touch/drawer expands on tap (accordion).
  expandOnHover?: boolean;
  // Fired after navigating to a destination — lets the mobile drawer close itself.
  onNavigate?: () => void;
};

// Portal keeps flyouts outside the sidebar's scroll clipping without moving its rows.
function DesktopSidebarNav() {
  const { pathname } = useLocation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 256, top: 8 });
  const navRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pinnedRef = useRef(false);
  const group = groups.find(item => item.id === openId);

  function cancelClose() { clearTimeout(closeTimer.current); }
  function closeGroup() {
    clearTimeout(closeTimer.current);
    pinnedRef.current = false;
    setOpenId(null);
  }
  function scheduleClose() {
    cancelClose();
    if (!pinnedRef.current) closeTimer.current = setTimeout(closeGroup, 220);
  }
  function openGroup(id: string, trigger: HTMLButtonElement) {
    cancelClose();
    triggerRef.current = trigger;
    const rect = trigger.getBoundingClientRect();
    const count = groups.find(item => item.id === id)?.children?.length ?? 0;
    const height = Math.min(count * 38 + 60, window.innerHeight - 16);
    setPosition({ left: navRef.current?.getBoundingClientRect().right ?? rect.right, top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)) });
    setOpenId(id);
  }

  useEffect(() => { closeGroup(); }, [pathname]);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) closeGroup();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && panelRef.current) {
        closeGroup();
        triggerRef.current?.focus();
      }
    }
    function resize() { closeGroup(); }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      clearTimeout(closeTimer.current);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <nav ref={navRef} aria-label="Main navigation" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3" onScroll={() => { if (!pinnedRef.current) closeGroup(); }}>
      {groups.map(item => {
        const Icon = item.icon;
        const active = item.children?.some(child => pathMatchesChild(pathname, child)) ?? pathname === item.to;
        const rowClass = cn('flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-hover hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold', active || openId === item.id ? 'bg-sidebar-active text-white' : 'text-sidebar-muted');
        if (!item.children) return <NavLink key={item.id} to={item.to ?? '/'} end className={rowClass} onClick={closeGroup} onMouseEnter={() => { if (!pinnedRef.current) closeGroup(); }}><Icon className="h-4 w-4 shrink-0" />{item.label}</NavLink>;
        return (
          <button key={item.id} type="button" className={rowClass} aria-expanded={openId === item.id} aria-controls={openId === item.id ? 'sidebar-flyout' : undefined}
            onMouseEnter={event => { if (!pinnedRef.current) openGroup(item.id, event.currentTarget); }} onMouseLeave={scheduleClose}
            onClick={event => { pinnedRef.current = true; openGroup(item.id, event.currentTarget); }}
            onKeyDown={event => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                pinnedRef.current = true;
                openGroup(item.id, event.currentTarget);
                requestAnimationFrame(() => panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus());
              }
            }}>
            <Icon className="h-4 w-4 shrink-0" /><span className="flex-1 text-left">{item.label}</span><ChevronRight className="h-4 w-4 shrink-0" />
          </button>
        );
      })}
      {group?.children && createPortal(
        <div ref={panelRef} id="sidebar-flyout" aria-label={`${group.label} pages`} className="fixed z-50 flex w-72 flex-col rounded-r-lg border border-white/10 bg-sidebar p-3 text-sidebar-foreground shadow-xl"
          style={{ left: position.left, top: position.top, maxHeight: 'calc(100dvh - 16px)' }}
          onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onFocus={cancelClose}
          onBlur={event => { if (!pinnedRef.current && !event.currentTarget.contains(event.relatedTarget)) closeGroup(); }}>
          <div className="shrink-0 border-b border-white/10 px-3 pb-3 text-sm font-semibold text-white">{group.label}</div>
          <div className="mt-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {group.children.map(child => <NavLink key={child.to} to={child.to} onClick={closeGroup} className={cn('shrink-0 rounded-md border-l-2 px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold', pathMatchesChild(pathname, child) ? 'border-gold bg-sidebar-active font-medium text-white' : 'border-transparent text-sidebar-muted hover:bg-sidebar-hover hover:text-white')}>{child.label}</NavLink>)}
          </div>
        </div>, document.body,
      )}
    </nav>
  );
}

// The navigation list itself, rendered both inside the static desktop sidebar and
// the mobile drawer. Interaction mode switches between hover (mouse) and tap.
export function SidebarNav({ expandOnHover = true, onNavigate }: SidebarNavProps) {
  const location = useLocation();
  const pathname = location.pathname;

  const activeGroupId = useMemo(() => {
    for (const g of groups) {
      if (!g.children) continue;
      if (g.children.some(c => pathMatchesChild(pathname, c))) return g.id;
    }
    return null;
  }, [pathname]);

  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  // Tap-to-expand accordion state for touch/drawer mode; defaults to the active group.
  const [openGroupId, setOpenGroupId] = useState<string | null>(activeGroupId);

  // Keep the tap accordion aligned with the active route in drawer mode.
  useEffect(() => {
    if (!expandOnHover) setOpenGroupId(activeGroupId);
  }, [activeGroupId, expandOnHover]);

  return (
    <nav
      className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3"
      onMouseLeave={() => {
        if (expandOnHover) setHoveredGroupId(null);
      }}
    >
      {groups.map(group => {
        const Icon = group.icon;
        const isActiveGroup = activeGroupId === group.id;
        const isOpen = expandOnHover
          ? hoveredGroupId === group.id || (hoveredGroupId === null && isActiveGroup)
          : openGroupId === group.id;
        const firstChild = group.children?.[0];

        if (!group.children || group.children.length === 0) {
          const to = group.to ?? '/';
          return (
            <NavLink
              key={group.id}
              to={to}
              end
              onClick={() => onNavigate?.()}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'hover:bg-sidebar-hover hover:text-white',
                  isActive
                    ? 'border-l-2 border-gold bg-sidebar-active text-white'
                    : 'text-sidebar-muted',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{group.label}</span>
            </NavLink>
          );
        }

        return (
          <div
            key={group.id}
            className="flex flex-col"
            onMouseEnter={() => {
              if (expandOnHover) setHoveredGroupId(group.id);
            }}
            onFocus={() => {
              if (expandOnHover) setHoveredGroupId(group.id);
            }}
          >
            {expandOnHover && firstChild ? (
              <NavLink
                to={firstChild.to}
                onClick={() => onNavigate?.()}
                aria-expanded={isOpen}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'hover:bg-sidebar-hover hover:text-white',
                  isActiveGroup
                    ? 'bg-sidebar-active text-white'
                    : 'text-sidebar-muted',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronRight
                  className={cn(
                    'h-4 w-4 text-sidebar-muted/70 transition-transform duration-200 ease-out',
                    isOpen && 'rotate-90',
                  )}
                />
              </NavLink>
            ) : (
              <button
                type="button"
                onClick={() => setOpenGroupId(id => (id === group.id ? null : group.id))}
                aria-expanded={isOpen}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'hover:bg-sidebar-hover hover:text-white',
                  isActiveGroup
                    ? 'bg-sidebar-active text-white'
                    : 'text-sidebar-muted',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronRight
                  className={cn(
                    'h-4 w-4 text-sidebar-muted/70 transition-transform duration-200 ease-out',
                    isOpen && 'rotate-90',
                  )}
                />
              </button>
            )}

            <div
              className={cn(
                'grid transition-all duration-200 ease-out',
                isOpen
                  ? 'grid-rows-[1fr] opacity-100 mt-0.5'
                  : 'grid-rows-[0fr] opacity-0 mt-0',
              )}
              aria-hidden={!isOpen}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-0.5 pl-6">
                  {group.children.map((child, idx) => {
                    const childActive = pathMatchesChild(pathname, child);
                    return (
                      <NavLink
                        key={`${group.id}-${child.to}`}
                        to={child.to}
                        tabIndex={isOpen ? 0 : -1}
                        onClick={() => onNavigate?.()}
                        style={{
                          transitionDelay: isOpen ? `${idx * 20}ms` : '0ms',
                        }}
                        className={cn(
                          'flex items-center rounded-md border-l-2 px-3 py-1.5 text-left text-sm transition-all duration-150 ease-out',
                          isOpen ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
                          childActive
                            ? 'border-gold bg-sidebar-active font-medium text-white'
                            : 'border-white/10 text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
                        )}
                      >
                        {child.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

// Static sidebar for desktop (`lg` and up). On smaller viewports it is hidden and
// the same nav is presented through the `MobileNav` drawer.
export function Sidebar() {
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground lg:flex">
      <SidebarBrand />
      <MyMenu />
      <CreateMenu />
      <BookmarkMenu />
      <DesktopSidebarNav />
    </aside>
  );
}
