import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type Customer = {
  id: string;
  name: string;
  billing_address: Record<string, string> | null;
};

type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  sale_price: string | null;
  is_active: boolean;
};

type CustomersResponse = { customers: Customer[] };
type ItemsResponse = { items: InventoryItem[] };

type Line = {
  inventory_item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
};

type CreatedSO = { id: string };

const blankLine = (): Line => ({
  inventory_item_id: '',
  description: '',
  quantity: '1',
  unit_price: '0.00',
});

const COLOR_SWATCHES = [
  '#9ca3af', '#111827', '#64748b', '#475569',
  '#16a34a', '#0891b2',
  '#0077c5', '#65a30d', '#166534', '#92400e', '#c2410c', '#991b1b',
  '#7c2d12', '#db2777', '#9333ea', '#4c1d95',
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none ${
        checked ? 'bg-green-500' : 'bg-gray-300'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-foreground">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function hexToLightBg(hex: string): string {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) throw new Error('bad hex');
    return `rgba(${r}, ${g}, ${b}, 0.08)`;
  } catch {
    return 'rgba(14, 165, 233, 0.08)';
  }
}

function fmtAddress(addr: Record<string, string> | null, name: string): string {
  if (!addr || Object.keys(addr).length === 0) return name;
  const cityLine = [addr['city'], addr['state'], addr['postal_code']].filter(Boolean).join(', ');
  return [name, addr['line1'], addr['line2'], cityLine, addr['country']]
    .filter(Boolean)
    .join('\n');
}

export default function SalesOrderNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const today = todayLocal();

  // Form data
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [billTo, setBillTo] = useState('');
  const [orderDate, setOrderDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Right panel
  const [panelOpen, setPanelOpen] = useState(true);
  const [openSection, setOpenSection] = useState<'customization' | 'discounts' | 'design' | null>('customization');
  function toggleSection(s: 'customization' | 'discounts' | 'design') {
    setOpenSection((prev) => (prev === s ? null : s));
  }

  // Customization toggles
  const [showBillTo, setShowBillTo] = useState(true);
  const [showSONumber, setShowSONumber] = useState(true);
  const [showSODate, setShowSODate] = useState(true);
  const [showNote, setShowNote] = useState(true);
  const [showLineNum, setShowLineNum] = useState(true);
  const [showDescription, setShowDescription] = useState(true);
  const [showQty, setShowQty] = useState(true);
  const [showRate, setShowRate] = useState(true);
  const [showAmount, setShowAmount] = useState(true);

  // Discounts and fees
  const [showSOTotal, setShowSOTotal] = useState(true);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showShippingFee, setShowShippingFee] = useState(false);
  const [discountPct, setDiscountPct] = useState('0');
  const [shippingFeeAmt, setShippingFeeAmt] = useState('0.00');

  // Design
  const [accentColor, setAccentColor] = useState('#0077c5');
  const [printerFriendly, setPrinterFriendly] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<CustomersResponse>(`/businesses/${bizId}/customers`)
      .then((r) => setCustomers(r.data.customers))
      .catch(() => setCustomers([]));
    api.get<ItemsResponse>(`/businesses/${bizId}/inventory-items`)
      .then((r) => setItems(r.data.items.filter((it) => it.is_active)))
      .catch(() => setItems([]));
  }, [bizId]);

  function pickCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setBillTo(c ? fmtAddress(c.billing_address, c.name) : '');
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickItem(i: number, itemId: string) {
    const item = items.find((it) => it.id === itemId);
    updateLine(i, {
      inventory_item_id: itemId,
      description: item?.name ?? '',
      unit_price: item?.sale_price ?? '0.00',
    });
  }

  function clearForm() {
    setCustomerId('');
    setBillTo('');
    setOrderDate(today);
    setMemo('');
    setLines([blankLine(), blankLine()]);
    setErr(null);
  }

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    [lines],
  );
  const discountAmt = showDiscount ? subtotal * (Number(discountPct) / 100) : 0;
  const shippingAmt = showShippingFee ? (Number(shippingFeeAmt) || 0) : 0;
  const total = subtotal - discountAmt + shippingAmt;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setErr(null);
    setBusy(true);
    try {
      const filledLines = lines.filter((l) => l.inventory_item_id !== '');
      if (filledLines.length === 0) {
        setErr('Add at least one line item.');
        setBusy(false);
        return;
      }
      const body = {
        customer_id: customerId,
        order_date: orderDate,
        memo: memo.trim() === '' ? null : memo,
        lines: filledLines.map((l) => ({
          inventory_item_id: l.inventory_item_id,
          description: l.description.trim() === '' ? null : l.description,
          quantity: parseMoneyInput(l.quantity),
          unit_price: parseMoneyInput(l.unit_price),
        })),
      };
      const r = await api.post<CreatedSO>(`/businesses/${bizId}/sales-orders`, body);
      nav(`/inventory/sales-orders/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to create sales order');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const accordionBtn = 'w-full flex items-center justify-between px-4 py-4 text-left hover:bg-muted/30 transition-colors';

  return (
    <form onSubmit={submit}>
      {/* Main content — shifts left when panel is open */}
      <div className={`space-y-6 pb-20 transition-[margin] duration-200 ${panelOpen ? 'mr-80' : ''}`}>

        {/* Header band — tinted with the selected accent color */}
        <div
          style={{ backgroundColor: hexToLightBg(accentColor) }}
          className="rounded-xl border p-6"
        >
          <div className="grid grid-cols-2 gap-6">

            {/* Left: customer + bill-to */}
            <div className="space-y-4">
              <div>
                <Label>Customer name</Label>
                <select
                  className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm shadow-sm"
                  value={customerId}
                  onChange={(e) => pickCustomer(e.target.value)}
                  required
                >
                  <option value="">Search and select…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {showBillTo && (
                <div>
                  <Label>Bill to</Label>
                  <textarea
                    value={billTo}
                    readOnly
                    rows={4}
                    placeholder="Select a customer to auto-fill"
                    className="mt-1 block w-full rounded-md border bg-white/70 px-3 py-2 text-sm text-muted-foreground shadow-sm resize-none"
                  />
                </div>
              )}
            </div>

            {/* Right: metadata */}
            <div className="space-y-4">
              {showSONumber && (
                <div>
                  <Label>Sales order no.</Label>
                  <Input value="(auto-assigned on save)" disabled className="mt-1 bg-white/70 text-muted-foreground" />
                </div>
              )}
              {showSODate && (
                <div>
                  <Label>Sales order date</Label>
                  <DateInput
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    required
                    className="mt-1 bg-white"
                  />
                </div>
              )}
              {showNote && (
                <div>
                  <Label>Note to customer</Label>
                  <Input
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Thank you for your business."
                    className="mt-1 bg-white"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Line items table */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                {showLineNum && <th className="w-10 px-3 py-3 text-left font-medium text-muted-foreground">#</th>}
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">Item</th>
                {showDescription && <th className="px-3 py-3 text-left font-medium text-muted-foreground">Description</th>}
                {showQty && <th className="w-20 px-3 py-3 text-right font-medium text-muted-foreground">Qty</th>}
                {showRate && <th className="w-28 px-3 py-3 text-right font-medium text-muted-foreground">Rate</th>}
                {showAmount && <th className="w-28 px-3 py-3 text-right font-medium text-muted-foreground">Amount</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const amount = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
                return (
                  <tr key={i} className="border-b last:border-b-0 group">
                    {showLineNum && (
                      <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{i + 1}</td>
                    )}
                    <td className="px-3 py-2">
                      <select
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={l.inventory_item_id}
                        onChange={(e) => pickItem(i, e.target.value)}
                      >
                        <option value="">Select item…</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
                        ))}
                      </select>
                    </td>
                    {showDescription && (
                      <td className="px-3 py-2">
                        <Input
                          value={l.description}
                          onChange={(e) => updateLine(i, { description: e.target.value })}
                          placeholder="Description"
                          className="h-9"
                        />
                      </td>
                    )}
                    {showQty && (
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={l.quantity}
                          onChange={(e) => updateLine(i, { quantity: e.target.value })}
                          className="h-9 text-right font-mono"
                        />
                      </td>
                    )}
                    {showRate && (
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.unit_price}
                          onChange={(e) => updateLine(i, { unit_price: e.target.value })}
                          className="h-9 text-right font-mono"
                        />
                      </td>
                    )}
                    {showAmount && (
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {fmtMoney(amount.toFixed(2))}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                        onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                        disabled={lines.length <= 1}
                        aria-label="Remove line"
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Table footer: add button + totals */}
          <div className="flex items-start justify-between p-4 border-t bg-muted/10">
            <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>
              Add product or service
            </Button>

            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{fmtMoney(subtotal.toFixed(2))}</span>
              </div>
              {showDiscount && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Discount</span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={discountPct}
                      onChange={(e) => setDiscountPct(e.target.value)}
                      className="h-7 w-16 text-right text-xs font-mono"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <span className="font-mono text-destructive">
                    -{fmtMoney(discountAmt.toFixed(2))}
                  </span>
                </div>
              )}
              {showShippingFee && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Shipping fee</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={shippingFeeAmt}
                    onChange={(e) => setShippingFeeAmt(e.target.value)}
                    className="h-7 w-24 text-right text-xs font-mono"
                  />
                </div>
              )}
              {showSOTotal && (
                <div className="flex justify-between items-center border-t pt-2 font-semibold">
                  <span>Sales order total</span>
                  <span className="font-mono">{fmtMoney(total.toFixed(2))}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>

      {/* ── Right panel ── */}
      {panelOpen && (
        <aside className="fixed top-14 right-0 bottom-[52px] w-80 border-l bg-card overflow-y-auto z-10 flex flex-col text-sm">

          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <span className="font-semibold">New Sales Order</span>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 1. Customization */}
          <div className="border-b">
            <button type="button" onClick={() => toggleSection('customization')} className={accordionBtn}>
              <span className="font-semibold">Customization</span>
              {openSection === 'customization' ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {openSection === 'customization' && (
              <div className="px-4 pb-4 space-y-3">
                {/* Ship to is not in our data model — always disabled */}
                <div className="flex items-center justify-between opacity-40">
                  <span className="text-sm">Ship to</span>
                  <Toggle checked={false} onChange={() => {}} />
                </div>
                <ToggleRow label="Bill to" checked={showBillTo} onChange={setShowBillTo} />
                <ToggleRow label="Note to customer" checked={showNote} onChange={setShowNote} />
                <ToggleRow label="Sales order number" checked={showSONumber} onChange={setShowSONumber} />
                <ToggleRow label="Sales order date" checked={showSODate} onChange={setShowSODate} />

                <div className="pt-3 border-t space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Table content</p>
                  <ToggleRow label="Line number" checked={showLineNum} onChange={setShowLineNum} />
                  <ToggleRow label="Description" checked={showDescription} onChange={setShowDescription} />
                  <ToggleRow label="Quantity" checked={showQty} onChange={setShowQty} />
                  <ToggleRow label="Rate" checked={showRate} onChange={setShowRate} />
                  <ToggleRow label="Amount" checked={showAmount} onChange={setShowAmount} />
                </div>
              </div>
            )}
          </div>

          {/* 2. Discounts and fees */}
          <div className="border-b">
            <button type="button" onClick={() => toggleSection('discounts')} className={accordionBtn}>
              <span className="font-semibold">Discounts and fees</span>
              {openSection === 'discounts' ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {openSection === 'discounts' && (
              <div className="px-4 pb-4 space-y-3">
                <ToggleRow label="Sales order total" checked={showSOTotal} onChange={setShowSOTotal} />
                <ToggleRow label="Discount" checked={showDiscount} onChange={setShowDiscount} />
                <ToggleRow label="Shipping fee" checked={showShippingFee} onChange={setShowShippingFee} />
              </div>
            )}
          </div>

          {/* 3. Design */}
          <div>
            <button type="button" onClick={() => toggleSection('design')} className={accordionBtn}>
              <span className="font-semibold">Design</span>
              {openSection === 'design' ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {openSection === 'design' && (
              <div className="px-4 pb-4 space-y-4">
                {/* Template */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold">Modernized Template</span>
                    <button type="button" className="text-xs text-primary hover:underline">Make default</button>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="so_template" defaultChecked readOnly className="accent-green-500" />
                    <span>Modern</span>
                  </label>
                </div>

                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Other Templates</span>
                    <button type="button" className="text-xs text-primary hover:underline">Add/Edit</button>
                  </div>
                </div>

                {/* Color */}
                <div className="border-t pt-3 space-y-3">
                  <p className="text-xs font-semibold">Color</p>
                  <div className="flex items-center justify-between">
                    <span>Printer friendly</span>
                    <Toggle checked={printerFriendly} onChange={setPrinterFriendly} />
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-7 w-7 shrink-0 rounded-full border-2 border-primary shadow-sm"
                      style={{ backgroundColor: accentColor }}
                    />
                    <Input
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-8 font-mono text-xs"
                      maxLength={7}
                    />
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {COLOR_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAccentColor(c)}
                        style={{ backgroundColor: c }}
                        aria-label={c}
                        className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                          accentColor === c
                            ? 'border-foreground ring-2 ring-foreground ring-offset-1'
                            : 'border-transparent'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Font */}
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-semibold">Font</p>
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    <option>Helvetica Neue</option>
                    <option>Arial</option>
                    <option>Times New Roman</option>
                    <option>Georgia</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Sticky bottom action bar */}
      <div
        className={`fixed bottom-0 left-64 z-20 border-t bg-card px-8 py-3 flex items-center justify-between shadow-sm transition-[right] duration-200 ${
          panelOpen ? 'right-80' : 'right-0'
        }`}
      >
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => nav('/inventory/sales-orders')}>
            Cancel
          </Button>
          <Button type="button" variant="ghost" onClick={clearForm}>
            Clear
          </Button>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
