import { api } from '@/lib/apiClient';
import { StandardReport, type ReportDates } from './StandardReport';
import {
  collectionsReportTable, customerContactListTable, estimatesByCustomerTable, invoiceListTable, isOpenOrder, openPurchaseOrderListTable,
  productServiceListTable, vendorContactListTable,
  type Contact, type EstimateRow, type InvoiceRow, type Item, type OpenInvoiceRow, type PurchaseOrderRow,
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

const loadProducts = async (bizId: string) =>
  productServiceListTable(await api.get<{ items: Item[] }>(`/businesses/${bizId}/inventory-items`).then(r => r.data.items));

const loadEstimates = async (bizId: string, range: ReportDates) =>
  estimatesByCustomerTable(await api.get<{ estimates: EstimateRow[] }>(`/businesses/${bizId}/estimates`).then(r => r.data.estimates), range);

async function loadOpenPurchaseOrders(bizId: string): Promise<ReportTable> {
  const [orders, vendors] = await Promise.all([
    api.get<{ purchase_orders: Omit<PurchaseOrderRow, 'lines'>[] }>(`/businesses/${bizId}/purchase-orders`).then(r => r.data.purchase_orders),
    fetchVendors(bizId, true),
  ]);
  // The list has no lines, so each open order is read for its amount.
  const open = await Promise.all(orders.filter(isOpenOrder).map(order =>
    api.get<PurchaseOrderRow>(`/businesses/${bizId}/purchase-orders/${order.id}`).then(r => r.data)));
  return openPurchaseOrderListTable(open, new Map(vendors.map(vendor => [vendor.id, vendor.name])));
}

async function loadInvoiceList(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [invoices, customers, open] = await Promise.all([fetchAllInvoices(bizId), fetchCustomers(bizId, true), fetchOpenInvoices(bizId, range.end)]);
  return invoiceListTable(
    invoices, new Map(customers.map(customer => [customer.id, customer.name])), new Map(open.map(invoice => [invoice.id, invoice.open])), range,
  );
}

async function loadCollections(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [open, customers] = await Promise.all([fetchOpenInvoices(bizId, range.end), fetchCustomers(bizId, true)]);
  const phones = new Map<string, string>();
  for (const customer of customers) {
    const phone = customer.phone || customer.mobile;
    if (phone) phones.set(customer.id, phone);
  }
  return collectionsReportTable(open, phones, range.end);
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
