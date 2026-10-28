import { api } from '@/lib/apiClient';
import { StandardReport, type ReportDates } from './StandardReport';
import {
  collectionsReportTable, customerContactListTable, estimatesByCustomerTable, inventoryValuationDetailTable, inventoryValuationSummaryTable,
  invoiceListTable, invoicesAndPaymentsTable, isOpenOrder, openPurchaseOrderDetailTable, openPurchaseOrderListTable,
  physicalInventoryWorksheetTable, productServiceListTable, salesTaxLiabilityTable, vendorContactListTable,
  type Contact, type EstimateRow, type InvoicePayments, type InvoiceRow, type Item, type OpenInvoiceRow, type PurchaseOrderRow,
  type SalesTaxReport, type ValuationItem,
} from './listReports';
import type { ReportTable } from './standardReports';

// The pages for listReports.ts (item 18, 10-27). As in StandardReportPages, the
// loaders stay at module level: the page reloads when its `load` changes.

/** Active customers only, unless `inactive`: a contact list leaves the inactive ones off, as QuickBooks does. */
const fetchCustomers = (bizId: string, inactive = false): Promise<Contact[]> =>
  api.get<{ customers: Contact[] }>(`/businesses/${bizId}/customers`, { params: inactive ? { include_inactive: 'true' } : {} })
    .then(r => r.data.customers);

const fetchVendors = (bizId: string, inactive = false): Promise<Contact[]> =>
  api.get<{ vendors: Contact[] }>(`/businesses/${bizId}/vendors`, { params: inactive ? { include_inactive: 'true' } : {} })
    .then(r => r.data.vendors);

const fetchOpenInvoices = (bizId: string, asOf: string): Promise<OpenInvoiceRow[]> =>
  api.get<{ rows: OpenInvoiceRow[] }>(`/businesses/${bizId}/reports/open-invoices`, { params: { as_of: asOf } })
    .then(r => r.data.rows);

// The invoice list comes a page at a time; the API gives at most 1000 at once.
const INVOICE_PAGE = 1000;

async function fetchAllInvoices(bizId: string): Promise<InvoiceRow[]> {
  const all: InvoiceRow[] = [];
  let page: InvoiceRow[];
  do {
    page = (await api.get<{ invoices: InvoiceRow[] }>(`/businesses/${bizId}/invoices`, { params: { limit: INVOICE_PAGE, offset: all.length } }))
      .data.invoices;
    all.push(...page);
  } while (page.length === INVOICE_PAGE);
  return all;
}

const loadCustomerContacts = async (bizId: string) => customerContactListTable(await fetchCustomers(bizId));
const loadVendorContacts = async (bizId: string) => vendorContactListTable(await fetchVendors(bizId));

/** Active items only, unless `inactive`. */
const fetchItems = (bizId: string, inactive = false): Promise<Item[]> =>
  api.get<{ items: Item[] }>(`/businesses/${bizId}/inventory-items`, { params: inactive ? { include_inactive: 'true' } : {} })
    .then(r => r.data.items);

const loadProducts = async (bizId: string) => productServiceListTable(await fetchItems(bizId));

const loadEstimates = async (bizId: string, range: ReportDates) =>
  estimatesByCustomerTable(await api.get<{ estimates: EstimateRow[] }>(`/businesses/${bizId}/estimates`).then(r => r.data.estimates), range);

/** The open purchase orders with their lines: the list has none, so each open order is read for them. */
async function fetchOpenOrders(bizId: string): Promise<PurchaseOrderRow[]> {
  const orders = await api.get<{ purchase_orders: Omit<PurchaseOrderRow, 'lines'>[] }>(`/businesses/${bizId}/purchase-orders`)
    .then(r => r.data.purchase_orders);
  return Promise.all(orders.filter(isOpenOrder).map(order =>
    api.get<PurchaseOrderRow>(`/businesses/${bizId}/purchase-orders/${order.id}`).then(r => r.data)));
}

const namesById = (list: { id: string; name: string }[]): Map<string, string> => new Map(list.map(entry => [entry.id, entry.name]));

async function loadOpenPurchaseOrders(bizId: string): Promise<ReportTable> {
  const [open, vendors] = await Promise.all([fetchOpenOrders(bizId), fetchVendors(bizId, true)]);
  return openPurchaseOrderListTable(open, namesById(vendors));
}

async function loadOpenPurchaseOrderDetail(bizId: string): Promise<ReportTable> {
  const [open, vendors, items] = await Promise.all([fetchOpenOrders(bizId), fetchVendors(bizId, true), fetchItems(bizId, true)]);
  return openPurchaseOrderDetailTable(open, namesById(vendors), namesById(items));
}

async function loadPhysicalInventory(bizId: string): Promise<ReportTable> {
  const [items, open] = await Promise.all([fetchItems(bizId), fetchOpenOrders(bizId)]);
  return physicalInventoryWorksheetTable(items, open);
}

async function loadInvoiceList(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [invoices, customers, open] = await Promise.all([fetchAllInvoices(bizId), fetchCustomers(bizId, true), fetchOpenInvoices(bizId, range.end)]);
  return invoiceListTable(
    invoices, new Map(customers.map(customer => [customer.id, customer.name])), new Map(open.map(invoice => [invoice.id, invoice.open])), range,
  );
}

const periodParams = (range: ReportDates) => ({ params: { period_start: range.start, period_end: range.end } });

const loadInvoicesAndPayments = async (bizId: string, range: ReportDates) =>
  invoicesAndPaymentsTable(await api.get<{ invoices: InvoicePayments[] }>(`/businesses/${bizId}/reports/invoices-and-payments`, periodParams(range))
    .then(r => r.data.invoices));

const loadSalesTaxLiability = async (bizId: string, range: ReportDates) =>
  salesTaxLiabilityTable(await api.get<SalesTaxReport>(`/businesses/${bizId}/reports/sales-tax-liability`, periodParams(range)).then(r => r.data), range);

async function loadCollections(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [open, customers] = await Promise.all([fetchOpenInvoices(bizId, range.end), fetchCustomers(bizId, true)]);
  const phones = new Map<string, string>();
  for (const customer of customers) {
    const phone = customer.phone || customer.mobile;
    if (phone) phones.set(customer.id, phone);
  }
  return collectionsReportTable(open, phones, range.end);
}

/** Each item's stock as of the date; with `periodStart`, where it stood then and every movement since. */
const fetchValuation = (bizId: string, asOf: string, periodStart?: string): Promise<ValuationItem[]> =>
  api.get<{ items: ValuationItem[] }>(`/businesses/${bizId}/reports/inventory-valuation`, {
    params: { as_of: asOf, ...(periodStart ? { period_start: periodStart } : {}) },
  }).then(r => r.data.items);

const loadValuationSummary = async (bizId: string, range: ReportDates) => inventoryValuationSummaryTable(await fetchValuation(bizId, range.end));
const loadValuationDetail = async (bizId: string, range: ReportDates) =>
  inventoryValuationDetailTable(await fetchValuation(bizId, range.end, range.start));

export function InventoryValuationSummaryPage() {
  return <StandardReport title="Inventory Valuation Summary" dates="asOf" fileStem="inventory-valuation-summary" load={loadValuationSummary} />;
}

export function InventoryValuationDetailPage() {
  return <StandardReport title="Inventory Valuation Detail" dates="period" fileStem="inventory-valuation-detail" load={loadValuationDetail} />;
}

export function CustomerContactListPage() {
  return <StandardReport title="Customer Contact List" dates="none" fileStem="customer-contact-list" load={loadCustomerContacts} />;
}

export function VendorContactListPage() {
  return <StandardReport title="Vendor Contact List" dates="none" fileStem="vendor-contact-list" load={loadVendorContacts} />;
}

export function ProductServiceListPage() {
  return <StandardReport title="Product/Service List" dates="none" fileStem="product-service-list" load={loadProducts} />;
}

export function EstimatesByCustomerPage() {
  return <StandardReport title="Estimates by Customer" dates="period" fileStem="estimates-by-customer" load={loadEstimates} />;
}

export function OpenPurchaseOrderListPage() {
  return <StandardReport title="Open Purchase Order List" dates="none" fileStem="open-purchase-orders" load={loadOpenPurchaseOrders} />;
}

export function InvoiceListReportPage() {
  return <StandardReport title="Invoice List" dates="period" fileStem="invoice-list" load={loadInvoiceList} />;
}

export function CollectionsReportPage() {
  return <StandardReport title="Collections Report" dates="asOf" fileStem="collections" load={loadCollections} />;
}

export function OpenPurchaseOrderDetailPage() {
  return <StandardReport title="Open Purchase Order Detail" dates="none" fileStem="open-purchase-order-detail" load={loadOpenPurchaseOrderDetail} />;
}

export function PhysicalInventoryWorksheetPage() {
  return <StandardReport title="Physical Inventory Worksheet" dates="none" fileStem="physical-inventory-worksheet" load={loadPhysicalInventory} />;
}

export function InvoicesAndPaymentsPage() {
  return <StandardReport title="Invoices and Received Payments" dates="period" fileStem="invoices-and-received-payments" load={loadInvoicesAndPayments} />;
}

export function SalesTaxLiabilityPage() {
  return <StandardReport title="Sales Tax Liability Report" dates="period" fileStem="sales-tax-liability" load={loadSalesTaxLiability} />;
}
