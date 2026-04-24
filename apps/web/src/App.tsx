import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import CoaListPage from '@/pages/coa/CoaListPage';
import PeriodsPage from '@/pages/periods/PeriodsPage';
import JournalListPage from '@/pages/journal/JournalListPage';
import JournalDetailPage from '@/pages/journal/JournalDetailPage';
import JournalNewPage from '@/pages/journal/JournalNewPage';
import TrialBalancePage from '@/pages/reports/TrialBalancePage';
import AgingReportPage from '@/pages/reports/AgingReportPage';
import StandardReportsPage from '@/pages/reports/StandardReportsPage';
import CustomerListPage from '@/pages/customers/CustomerListPage';
import CustomerNewPage from '@/pages/customers/CustomerNewPage';
import CustomerDetailPage from '@/pages/customers/CustomerDetailPage';
import InvoiceListPage from '@/pages/invoices/InvoiceListPage';
import InvoiceNewPage from '@/pages/invoices/InvoiceNewPage';
import InvoiceDetailPage from '@/pages/invoices/InvoiceDetailPage';
import PaymentListPage from '@/pages/payments/PaymentListPage';
import PaymentNewPage from '@/pages/payments/PaymentNewPage';
import PaymentDetailPage from '@/pages/payments/PaymentDetailPage';
import CreditMemoListPage from '@/pages/credit-memos/CreditMemoListPage';
import CreditMemoNewPage from '@/pages/credit-memos/CreditMemoNewPage';
import CreditMemoDetailPage from '@/pages/credit-memos/CreditMemoDetailPage';
import VendorListPage from '@/pages/vendors/VendorListPage';
import VendorNewPage from '@/pages/vendors/VendorNewPage';
import VendorDetailPage from '@/pages/vendors/VendorDetailPage';
import BillListPage from '@/pages/bills/BillListPage';
import BillNewPage from '@/pages/bills/BillNewPage';
import BillDetailPage from '@/pages/bills/BillDetailPage';
import BillPaymentListPage from '@/pages/bill-payments/BillPaymentListPage';
import BillPaymentNewPage from '@/pages/bill-payments/BillPaymentNewPage';
import BillPaymentDetailPage from '@/pages/bill-payments/BillPaymentDetailPage';
import VendorCreditListPage from '@/pages/vendor-credits/VendorCreditListPage';
import VendorCreditNewPage from '@/pages/vendor-credits/VendorCreditNewPage';
import VendorCreditDetailPage from '@/pages/vendor-credits/VendorCreditDetailPage';
import TenNinetyNineReportPage from '@/pages/reports/TenNinetyNineReportPage';
import ProfitLossPage from '@/pages/reports/ProfitLossPage';
import BalanceSheetPage from '@/pages/reports/BalanceSheetPage';
import CashFlowPage from '@/pages/reports/CashFlowPage';
import TaxCodesPage from '@/pages/settings/TaxCodesPage';
import BankAccountListPage from '@/pages/banking/BankAccountListPage';
import BankTransactionsInboxPage from '@/pages/banking/BankTransactionsInboxPage';
import BankTransactionImportPage from '@/pages/banking/BankTransactionImportPage';
import ReconcilePage from '@/pages/banking/ReconcilePage';
import RulesPage from '@/pages/accounting/RulesPage';
import FixedAssetListPage from '@/pages/accounting/FixedAssetListPage';
import FixedAssetNewPage from '@/pages/accounting/FixedAssetNewPage';
import FixedAssetDetailPage from '@/pages/accounting/FixedAssetDetailPage';
import ComingSoonPage from '@/pages/ComingSoonPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />

            {/* Accounts Receivable */}
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/customers/new" element={<CustomerNewPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/invoices" element={<InvoiceListPage />} />
            <Route path="/invoices/new" element={<InvoiceNewPage />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="/payments" element={<PaymentListPage />} />
            <Route path="/payments/new" element={<PaymentNewPage />} />
            <Route path="/payments/:id" element={<PaymentDetailPage />} />
            <Route path="/credit-memos" element={<CreditMemoListPage />} />
            <Route path="/credit-memos/new" element={<CreditMemoNewPage />} />
            <Route path="/credit-memos/:id" element={<CreditMemoDetailPage />} />

            {/* Accounting */}
            <Route path="/journal" element={<JournalListPage />} />
            <Route path="/journal/new" element={<JournalNewPage />} />
            <Route path="/journal/:id" element={<JournalDetailPage />} />

            {/* Reports */}
            <Route path="/reports/standard" element={<StandardReportsPage />} />
            <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
            <Route path="/reports/aging" element={<AgingReportPage />} />
            <Route path="/reports/pnl" element={<ProfitLossPage />} />
            <Route path="/reports/balance-sheet" element={<BalanceSheetPage />} />
            <Route path="/reports/cash-flow" element={<CashFlowPage />} />
            <Route path="/reports/custom" element={<ComingSoonPage title="Custom Reports" description="Build reports with custom filters, columns, and grouping." eta="Slice 3" />} />
            <Route path="/reports/management" element={<ComingSoonPage title="Management Reports" description="Executive dashboards and KPI-driven management views." eta="Slice 3" />} />
            <Route path="/reports/performance" element={<ComingSoonPage title="Performance Center" description="Benchmarks and performance analytics across clients." eta="Slice 4" />} />
            <Route path="/reports/financial-planning" element={<ComingSoonPage title="Financial Planning" description="Budgets, forecasts, and scenario planning." eta="Slice 4" />} />
            <Route path="/reports/spreadsheet-sync" element={<ComingSoonPage title="Spreadsheet Sync" description="Two-way sync between your ledger and Google Sheets / Excel." eta="Slice 4" />} />

            {/* Settings (existing) */}
            <Route path="/settings/coa" element={<CoaListPage />} />
            <Route path="/settings/tax-codes" element={<TaxCodesPage />} />
            <Route path="/settings/periods" element={<PeriodsPage />} />

            {/* Accounts Payable */}
            <Route path="/ap/overview" element={<ComingSoonPage title="AP Overview" description="A single view of outstanding bills, upcoming payments, and vendor health." eta="Slice 3" />} />
            <Route path="/ap/expenses" element={<ComingSoonPage title="Expense Transactions" description="Capture and categorize expenses as they hit the ledger." eta="Slice 3" />} />
            <Route path="/ap/vendors" element={<VendorListPage />} />
            <Route path="/ap/vendors/new" element={<VendorNewPage />} />
            <Route path="/ap/vendors/:id" element={<VendorDetailPage />} />
            <Route path="/ap/bills" element={<BillListPage />} />
            <Route path="/ap/bills/new" element={<BillNewPage />} />
            <Route path="/ap/bills/:id" element={<BillDetailPage />} />
            <Route path="/ap/bill-payments" element={<BillPaymentListPage />} />
            <Route path="/ap/bill-payments/new" element={<BillPaymentNewPage />} />
            <Route path="/ap/bill-payments/:id" element={<BillPaymentDetailPage />} />
            <Route path="/ap/vendor-credits" element={<VendorCreditListPage />} />
            <Route path="/ap/vendor-credits/new" element={<VendorCreditNewPage />} />
            <Route path="/ap/vendor-credits/:id" element={<VendorCreditDetailPage />} />
            <Route path="/ap/contractors" element={<ComingSoonPage title="Contractors" description="Manage 1099 contractors and track their payments." eta="Slice 3" />} />
            <Route path="/reports/1099" element={<TenNinetyNineReportPage />} />

            {/* Accounting (placeholders) */}
            <Route path="/accounting/client-overview" element={<ComingSoonPage title="Client Overview" description="A workspace-level view of all your clients' books." eta="Slice 3" />} />
            <Route path="/accounting/books-review" element={<ComingSoonPage title="Books Review" description="Review checklists and month-end close workflows." eta="Slice 3" />} />
            <Route path="/accounting/bank-accounts" element={<BankAccountListPage />} />
            <Route path="/accounting/bank-transactions" element={<BankTransactionsInboxPage />} />
            <Route path="/accounting/bank-transactions/import" element={<BankTransactionImportPage />} />
            <Route path="/accounting/integrations" element={<ComingSoonPage title="Integration Transactions" description="Activity coming in from third-party integrations." eta="Slice 4" />} />
            <Route path="/accounting/receipts" element={<ComingSoonPage title="Receipts" description="Upload and match receipts to transactions." eta="Slice 4" />} />
            <Route path="/accounting/reconcile" element={<ReconcilePage />} />
            <Route path="/accounting/rules" element={<RulesPage />} />
            <Route path="/accounting/recurring" element={<ComingSoonPage title="Recurring Transactions" description="Schedule recurring journal entries, invoices, and bills." eta="Slice 3" />} />
            <Route path="/accounting/fixed-assets" element={<FixedAssetListPage />} />
            <Route path="/accounting/fixed-assets/new" element={<FixedAssetNewPage />} />
            <Route path="/accounting/fixed-assets/:id" element={<FixedAssetDetailPage />} />

            {/* Setup (placeholders) */}
            <Route path="/setup/entity" element={<ComingSoonPage title="Entity" description="Legal entity, addresses, fiscal year, and tax IDs." eta="Slice 2" />} />
            <Route path="/setup/coa" element={<CoaListPage />} />
            <Route path="/setup/cost-centers" element={<ComingSoonPage title="Cost Centers" description="Departments, classes, and locations for segment reporting." eta="Slice 3" />} />
            <Route path="/setup/users" element={<ComingSoonPage title="Users" description="Invite team members and assign roles." eta="Slice 2" />} />

            {/* Payroll (placeholders) */}
            <Route path="/payroll/overview" element={<ComingSoonPage title="Payroll Overview" description="Upcoming runs, liabilities, and payroll health." eta="Slice 5" />} />
            <Route path="/payroll/employees" element={<ComingSoonPage title="Employees" description="W-2 employees, pay rates, and deductions." eta="Slice 5" />} />
            <Route path="/payroll/contractors" element={<ComingSoonPage title="Payroll Contractors" description="1099 contractors paid through payroll." eta="Slice 5" />} />
            <Route path="/payroll/taxes" element={<ComingSoonPage title="Payroll Taxes" description="Federal, state, and local payroll tax filings." eta="Slice 5" />} />
            <Route path="/payroll/compliance" element={<ComingSoonPage title="Compliance" description="State registrations, new-hire reporting, and labor-law notices." eta="Slice 5" />} />

            {/* Inventory (placeholders) */}
            <Route path="/inventory/overview" element={<ComingSoonPage title="Inventory Overview" description="Stock levels, on-order quantity, and low-stock alerts." eta="Slice 6" />} />
            <Route path="/inventory/items" element={<ComingSoonPage title="Inventory" description="Item master with cost, pricing, and tracking method." eta="Slice 6" />} />
            <Route path="/inventory/purchase-orders" element={<ComingSoonPage title="Purchase Orders" description="Issue POs to vendors for inventory replenishment." eta="Slice 6" />} />
            <Route path="/inventory/item-receipts" element={<ComingSoonPage title="Item Receipts" description="Receive inventory from purchase orders." eta="Slice 6" />} />
            <Route path="/inventory/sales-orders" element={<ComingSoonPage title="Sales Orders" description="Confirm customer orders before fulfillment." eta="Slice 6" />} />
            <Route path="/inventory/shipping-labels" element={<ComingSoonPage title="Shipping Labels" description="Buy and print shipping labels from connected carriers." eta="Slice 6" />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
