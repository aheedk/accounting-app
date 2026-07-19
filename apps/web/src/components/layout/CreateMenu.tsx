import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type CreateItem = { label: string; to: string };
type CreateCategory = { heading: string; items: CreateItem[] };

const CATEGORIES: CreateCategory[] = [
  {
    heading: 'Customers',
    items: [
      { label: 'Invoice', to: '/invoices/new' },
      { label: 'Receive payment', to: '/payments/new' },
      { label: 'Credit memo', to: '/credit-memos/new' },
      { label: 'Add customer', to: '/customers/new' },
    ],
  },
  {
    heading: 'Vendors',
    items: [
      { label: 'Expense', to: '/ap/expenses/new' },
      { label: 'Bill', to: '/ap/bills/new' },
      { label: 'Pay bills', to: '/ap/bill-payments/new' },
      { label: 'Vendor credit', to: '/ap/vendor-credits/new' },
      { label: 'Add vendor', to: '/ap/vendors/new' },
    ],
  },
  {
    heading: 'Team',
    items: [
      { label: 'Add employee', to: '/payroll/employees/new' },
    ],
  },
  {
    heading: 'Other',
    items: [
      { label: 'Journal entry', to: '/journal/new' },
      { label: 'Fixed asset', to: '/accounting/fixed-assets/new' },
      { label: 'Sales order', to: '/inventory/sales-orders/new' },
      { label: 'Purchase order', to: '/inventory/purchase-orders/new' },
      { label: 'Add client', to: '/clients/new' },
    ],
  },
];

export function CreateMenu() {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleClose() {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function openMenu() {
    cancelClose();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopupPos({ top: rect.top, left: rect.right + 4 });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function handleItem(to: string) {
    setOpen(false);
    navigate(to);
  }

  const popup = open
    ? createPortal(
        <div
          ref={popupRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: popupPos.top, left: popupPos.left, zIndex: 9999 }}
          className="w-max rounded-lg border bg-card p-5 shadow-card"
        >
          <div className="grid grid-cols-4 gap-8">
            {CATEGORIES.map(cat => (
              <div key={cat.heading} className="min-w-[8rem]">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-foreground">
                  {cat.heading}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {cat.items.map(item => (
                    <li key={item.to}>
                      <button
                        type="button"
                        onClick={() => handleItem(item.to)}
                        className="w-full rounded px-1 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="px-3 py-2">
      <button
        ref={buttonRef}
        type="button"
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label="Create"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
          'bg-gold/90 text-sidebar hover:bg-gold',
        )}
      >
        <Plus className="h-4 w-4 shrink-0" />
        <span>Create</span>
      </button>
      {popup}
    </div>
  );
}
