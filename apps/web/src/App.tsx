import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { ChatPanelHost } from '@/components/chat/ChatPanelHost';
import { FirmShell } from '@/components/layout/FirmShell';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import AccountPage from '@/pages/AccountPage';
import ActivityLogPage from '@/pages/setup/ActivityLogPage';
import MessagesPage from '@/pages/MessagesPage';
import ApprovalsPage from '@/pages/accounting/ApprovalsPage';
import CustomerStatementPage from '@/pages/reports/CustomerStatementPage';
import SendDocumentsPage from '@/pages/client/SendDocumentsPage';
import CoaListPage from '@/pages/coa/CoaListPage';
import AccountRegisterPage from '@/pages/coa/AccountRegisterPage';
import PeriodsPage from '@/pages/periods/PeriodsPage';
import JournalDetailPage from '@/pages/journal/JournalDetailPage';
import JournalNewPage from '@/pages/journal/JournalNewPage';
import { JournalLandingPage } from '@/pages/journal/journalLanding';
import { JOURNAL_NAV_ITEM } from '@/pages/journal/journalNavigation';
import TrialBalancePage from '@/pages/reports/TrialBalancePage';
import GeneralLedgerPage from '@/pages/reports/GeneralLedgerPage';
import AgingReportPage from '@/pages/reports/AgingReportPage';
import StandardReportsPage from '@/pages/reports/StandardReportsPage';
import {
  AccountListPage, BalanceSheetComparisonPage, BalanceSheetDetailPage, CustomerBalanceSummaryPage, ExpensesByVendorSummaryPage,
  JournalReportPage, OpenInvoicesPage, ProfitLossByMonthPage, ProfitLossComparisonPage, ProfitLossDetailPage, SalesByCustomerSummaryPage,
  TransactionListByDatePage, UnpaidBillsPage, VendorBalanceSummaryPage,
} from '@/pages/reports/StandardReportPages';
import CustomerListPage from '@/pages/customers/CustomerListPage';
import CustomerNewPage from '@/pages/customers/CustomerNewPage';
import CustomerDetailPage from '@/pages/customers/CustomerDetailPage';
import InvoiceListPage from '@/pages/invoices/InvoiceListPage';
import InvoiceNewPage from '@/pages/invoices/InvoiceNewPage';
import InvoiceDetailPage from '@/pages/invoices/InvoiceDetailPage';
import EstimateListPage from '@/pages/estimates/EstimateListPage';
import EstimateFormPage from '@/pages/estimates/EstimateFormPage';
import EstimateDetailPage from '@/pages/estimates/EstimateDetailPage';
import PaymentListPage from '@/pages/payments/PaymentListPage';
import PaymentNewPage from '@/pages/payments/PaymentNewPage';
import PaymentDetailPage from '@/pages/payments/PaymentDetailPage';
import CreditMemoListPage from '@/pages/credit-memos/CreditMemoListPage';
import CreditMemoNewPage from '@/pages/credit-memos/CreditMemoNewPage';
import CreditMemoDetailPage from '@/pages/credit-memos/CreditMemoDetailPage';
import VendorListPage from '@/pages/vendors/VendorListPage';
import VendorNewPage from '@/pages/vendors/VendorNewPage';
import VendorEditPage from '@/pages/vendors/VendorEditPage';
import VendorDetailPage from '@/pages/vendors/VendorDetailPage';
import BillListPage from '@/pages/bills/BillListPage';
import BillNewPage from '@/pages/bills/BillNewPage';
import BillDetailPage from '@/pages/bills/BillDetailPage';
import BillPaymentListPage from '@/pages/bill-payments/BillPaymentListPage';
import BillPaymentNewPage from '@/pages/bill-payments/BillPaymentNewPage';
import PayBillsPage from '@/pages/bill-payments/PayBillsPage';
import BillPaymentDetailPage from '@/pages/bill-payments/BillPaymentDetailPage';
import VendorCreditListPage from '@/pages/vendor-credits/VendorCreditListPage';
import VendorCreditNewPage from '@/pages/vendor-credits/VendorCreditNewPage';
import VendorCreditDetailPage from '@/pages/vendor-credits/VendorCreditDetailPage';
import TenNinetyNineReportPage from '@/pages/reports/TenNinetyNineReportPage';
import ProfitLossPage from '@/pages/reports/ProfitLossPage';
import BalanceSheetPage from '@/pages/reports/BalanceSheetPage';
import CashFlowPage from '@/pages/reports/CashFlowPage';
import ReconciliationReportsPage from '@/pages/reports/ReconciliationReportsPage';
import ReconciliationReportPage from '@/pages/reports/ReconciliationReportPage';
import StatementOfCashFlowsPage from '@/pages/reports/StatementOfCashFlowsPage';
import CustomReportsPage from '@/pages/reports/CustomReportsPage';
import ManagementReportsPage from '@/pages/reports/ManagementReportsPage';
import PerformanceCenterPage from '@/pages/reports/PerformanceCenterPage';
import FinancialPlanningPage from '@/pages/reports/FinancialPlanningPage';
import SpreadsheetSyncPage from '@/pages/reports/SpreadsheetSyncPage';
import TaxCodesPage from '@/pages/settings/TaxCodesPage';
import BankAccountListPage from '@/pages/banking/BankAccountListPage';
import BankTransactionsInboxPage from '@/pages/banking/BankTransactionsInboxPage';
import EmailImportReviewPage from '@/pages/banking/EmailImportReviewPage';
import ImportedTransactionPage from '@/pages/banking/ImportedTransactionPage';
import CodingRulesPage from '@/pages/ai/CodingRulesPage';
import SuspensePage from '@/pages/ai/SuspensePage';
import BankTransactionImportPage from '@/pages/banking/BankTransactionImportPage';
import ReconcilePage from '@/pages/banking/ReconcilePage';
import ReconcileWorksheetPage from '@/pages/banking/ReconcileWorksheetPage';
import ReconcileHistoryPage from '@/pages/banking/ReconcileHistoryPage';
import ReconcileSummaryPage from '@/pages/banking/ReconcileSummaryPage';
import RulesPage from '@/pages/accounting/RulesPage';
import FixedAssetListPage from '@/pages/accounting/FixedAssetListPage';
import FixedAssetNewPage from '@/pages/accounting/FixedAssetNewPage';
import FixedAssetDetailPage from '@/pages/accounting/FixedAssetDetailPage';
import BankDepositPage from '@/pages/accounting/BankDepositPage';
import TransferNewPage from '@/pages/accounting/TransferNewPage';
import BankDepositListPage from '@/pages/accounting/BankDepositListPage';
import ExpensePage from '@/pages/accounting/ExpensePage';
import CheckListPage from '@/pages/accounting/CheckListPage';
import TransactionsPage from '@/pages/accounting/TransactionsPage';
import CheckPage from '@/pages/accounting/CheckPage';
import ExpenseListPage from '@/pages/accounting/ExpenseListPage';
import EntityPage from '@/pages/setup/EntityPage';
import CompanySettingsPage from '@/pages/setup/CompanySettingsPage';
import AddClientPage from '@/pages/setup/AddClientPage';
import UsersPage from '@/pages/setup/UsersPage';
import CostCentersPage from '@/pages/setup/CostCentersPage';
import InventoryListPage from '@/pages/inventory/InventoryListPage';
import InventoryNewPage from '@/pages/inventory/InventoryNewPage';
import InventoryDetailPage from '@/pages/inventory/InventoryDetailPage';
import InventoryOverviewPage from '@/pages/inventory/InventoryOverviewPage';
import PurchaseOrderListPage from '@/pages/inventory/PurchaseOrderListPage';
import PurchaseOrderNewPage from '@/pages/inventory/PurchaseOrderNewPage';
import PurchaseOrderDetailPage from '@/pages/inventory/PurchaseOrderDetailPage';
import ItemReceiptListPage from '@/pages/inventory/ItemReceiptListPage';
import ItemReceiptNewPage from '@/pages/inventory/ItemReceiptNewPage';
import SalesOrderListPage from '@/pages/inventory/SalesOrderListPage';
import SalesOrderNewPage from '@/pages/inventory/SalesOrderNewPage';
import SalesOrderDetailPage from '@/pages/inventory/SalesOrderDetailPage';
import ShippingLabelListPage from '@/pages/inventory/ShippingLabelListPage';
import ShippingLabelNewPage from '@/pages/inventory/ShippingLabelNewPage';
import ApOverviewPage from '@/pages/ap/ApOverviewPage';
import ContractorsPage from '@/pages/ap/ContractorsPage';
import ClientOverviewPage from '@/pages/accounting/ClientOverviewPage';
import BooksReviewPage from '@/pages/accounting/BooksReviewPage';
import RecurringTransactionsPage from '@/pages/accounting/RecurringTransactionsPage';
import ReceiptsPage from '@/pages/accounting/ReceiptsPage';
import IntegrationInboxPage from '@/pages/accounting/IntegrationInboxPage';
import PayrollOverviewPage from '@/pages/payroll/PayrollOverviewPage';
import PayRunListPage from '@/pages/payroll/PayRunListPage';
import PayRunNewPage from '@/pages/payroll/PayRunNewPage';
import EmployeeListPage from '@/pages/payroll/EmployeeListPage';
import EmployeeNewPage from '@/pages/payroll/EmployeeNewPage';
import EmployeeDetailPage from '@/pages/payroll/EmployeeDetailPage';
import PayrollContractorsPage from '@/pages/payroll/PayrollContractorsPage';
import PayrollTaxesPage from '@/pages/payroll/PayrollTaxesPage';
import CompliancePage from '@/pages/payroll/CompliancePage';
// ComingSoonPage component intentionally kept in apps/web/src/pages/ for future stubs.

export default function App() {
  return (
    <AuthProvider>
      <ChatPanelHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          {/* The firm's view with no client selected: its own top bar, outside AppShell. */}
          <Route path="/firm" element={<FirmShell />}>
            <Route index element={<ClientOverviewPage />} />
          </Route>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/setup/activity" element={<ActivityLogPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/accounting/approvals" element={<ApprovalsPage />} />
            <Route path="/reports/customer-statement" element={<CustomerStatementPage />} />
            <Route path="/documents/send" element={<SendDocumentsPage />} />

            {/* Accounts Receivable */}
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/customers/new" element={<CustomerNewPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/invoices" element={<InvoiceListPage />} />
            <Route path="/invoices/new" element={<InvoiceNewPage />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="/estimates" element={<EstimateListPage />} />
            <Route path="/estimates/new" element={<EstimateFormPage />} />
            <Route path="/estimates/:id" element={<EstimateDetailPage />} />
            <Route path="/estimates/:id/edit" element={<EstimateFormPage />} />
            <Route path="/payments" element={<PaymentListPage />} />
            <Route path="/payments/new" element={<PaymentNewPage />} />
            <Route path="/payments/:id" element={<PaymentDetailPage />} />
            <Route path="/credit-memos" element={<CreditMemoListPage />} />
            <Route path="/credit-memos/new" element={<CreditMemoNewPage />} />
            <Route path="/credit-memos/:id" element={<CreditMemoDetailPage />} />

            {/* Accounting */}
            <Route path={JOURNAL_NAV_ITEM.path} element={<JournalLandingPage />} />
            <Route path="/journal/new" element={<JournalNewPage />} />
            <Route path="/journal/:id" element={<JournalDetailPage />} />
            <Route path="/transactions/:id" element={<ImportedTransactionPage />} />

            {/* Reports */}
            <Route path="/reports/standard" element={<StandardReportsPage />} />
            <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
            <Route path="/reports/general-ledger" element={<GeneralLedgerPage />} />
            <Route path="/reports/aging" element={<AgingReportPage />} />
            <Route path="/reports/ap-aging" element={<AgingReportPage kind="ap" />} />
            <Route path="/reports/customer-balances" element={<CustomerBalanceSummaryPage />} />
            <Route path="/reports/vendor-balances" element={<VendorBalanceSummaryPage />} />
            <Route path="/reports/open-invoices" element={<OpenInvoicesPage />} />
            <Route path="/reports/unpaid-bills" element={<UnpaidBillsPage />} />
            <Route path="/reports/pnl" element={<ProfitLossPage />} />
            <Route path="/reports/pnl-detail" element={<ProfitLossDetailPage />} />
            <Route path="/reports/pnl-by-month" element={<ProfitLossByMonthPage />} />
            <Route path="/reports/pnl-comparison" element={<ProfitLossComparisonPage />} />
            <Route path="/reports/balance-sheet-detail" element={<BalanceSheetDetailPage />} />
            <Route path="/reports/balance-sheet-comparison" element={<BalanceSheetComparisonPage />} />
            <Route path="/reports/account-list" element={<AccountListPage />} />
            <Route path="/reports/journal" element={<JournalReportPage />} />
            <Route path="/reports/transaction-list-by-date" element={<TransactionListByDatePage />} />
            <Route path="/reports/sales-by-customer" element={<SalesByCustomerSummaryPage />} />
            <Route path="/reports/expenses-by-vendor" element={<ExpensesByVendorSummaryPage />} />
            <Route path="/reports/balance-sheet" element={<BalanceSheetPage />} />
            <Route path="/reports/cash-flow" element={<CashFlowPage />} />
            <Route path="/reports/reconciliation" element={<ReconciliationReportsPage />} />
            <Route path="/reports/reconciliation/:id" element={<ReconciliationReportPage />} />
            <Route path="/reports/statement-of-cash-flows" element={<StatementOfCashFlowsPage />} />
            <Route path="/reports/custom" element={<CustomReportsPage />} />
            <Route path="/reports/management" element={<ManagementReportsPage />} />
            <Route path="/reports/performance" element={<PerformanceCenterPage />} />
            <Route path="/reports/financial-planning" element={<FinancialPlanningPage />} />
            <Route path="/reports/spreadsheet-sync" element={<SpreadsheetSyncPage />} />

            {/* Settings (existing) */}
            <Route path="/settings/coa" element={<CoaListPage />} />
            <Route path="/settings/coa/:accountId/register" element={<AccountRegisterPage />} />
            {/* Legacy path shipped on prod — keep so old links resolve. */}
            <Route path="/coa/:accountId/register" element={<AccountRegisterPage />} />
            <Route path="/settings/tax-codes" element={<TaxCodesPage />} />
            <Route path="/settings/periods" element={<PeriodsPage />} />

            {/* Accounts Payable */}
            <Route path="/ap/overview" element={<ApOverviewPage />} />
            <Route path="/ap/vendors" element={<VendorListPage />} />
            <Route path="/ap/vendors/new" element={<VendorNewPage />} />
            <Route path="/ap/vendors/:id/edit" element={<VendorEditPage />} />
            <Route path="/ap/vendors/:id" element={<VendorDetailPage />} />
            <Route path="/ap/bills" element={<BillListPage />} />
            <Route path="/ap/bills/new" element={<BillNewPage />} />
            <Route path="/ap/bills/:id" element={<BillDetailPage />} />
            <Route path="/ap/bill-payments" element={<BillPaymentListPage />} />
            <Route path="/ap/pay-bills" element={<PayBillsPage />} />
            <Route path="/ap/bill-payments/new" element={<BillPaymentNewPage />} />
            <Route path="/ap/bill-payments/:id" element={<BillPaymentDetailPage />} />
            <Route path="/ap/vendor-credits" element={<VendorCreditListPage />} />
            <Route path="/ap/vendor-credits/new" element={<VendorCreditNewPage />} />
            <Route path="/ap/vendor-credits/:id" element={<VendorCreditDetailPage />} />
            <Route path="/ap/contractors" element={<ContractorsPage />} />
            <Route path="/reports/1099" element={<TenNinetyNineReportPage />} />

            {/* Accounting (placeholders) */}
            {/* Client Overview moved to the firm view; old links and bookmarks land there. */}
            <Route path="/accounting/client-overview" element={<Navigate to="/firm" replace />} />
            <Route path="/accounting/books-review" element={<BooksReviewPage />} />
            <Route path="/accounting/bank-accounts" element={<BankAccountListPage />} />
            <Route path="/accounting/bank-transactions" element={<BankTransactionsInboxPage />} />
            <Route path="/accounting/bank-deposits" element={<BankDepositListPage />} />
            <Route path="/accounting/bank-deposits/new" element={<BankDepositPage />} />
            <Route path="/accounting/transfers/new" element={<TransferNewPage />} />
            <Route path="/accounting/bank-deposits/:id" element={<BankDepositPage />} />
            <Route path="/accounting/expense-transactions" element={<ExpenseListPage />} />
            <Route path="/accounting/expenses/new" element={<ExpensePage />} />
            <Route path="/accounting/expenses/:id" element={<ExpensePage />} />
            <Route path="/accounting/transactions" element={<TransactionsPage />} />
            <Route path="/accounting/checks" element={<CheckListPage />} />
            <Route path="/accounting/checks/new" element={<CheckPage />} />
            <Route path="/accounting/checks/:id" element={<CheckPage />} />
            {/* AI is a top-level area now; the old paths redirect so existing links keep working. */}
            <Route path="/ai/inbox" element={<EmailImportReviewPage />} />
            <Route path="/ai/coding-rules" element={<CodingRulesPage />} />
            <Route path="/ai/suspense" element={<SuspensePage />} />
            <Route path="/accounting/email-imports" element={<Navigate to="/ai/inbox" replace />} />
            <Route path="/accounting/invoice-imports" element={<Navigate to="/ai/inbox" replace />} />
            <Route path="/accounting/bank-transactions/import" element={<BankTransactionImportPage />} />
            <Route path="/accounting/integrations" element={<IntegrationInboxPage />} />
            <Route path="/accounting/receipts" element={<ReceiptsPage />} />
            <Route path="/accounting/reconcile" element={<ReconcilePage />} />
            <Route path="/accounting/reconcile/history" element={<ReconcileHistoryPage />} />
            <Route path="/accounting/reconcile/summary" element={<ReconcileSummaryPage />} />
            <Route path="/accounting/reconcile/:id" element={<ReconcileWorksheetPage />} />
            <Route path="/accounting/register" element={<AccountRegisterPage />} />
            <Route path="/accounting/rules" element={<RulesPage />} />
            <Route path="/accounting/recurring" element={<RecurringTransactionsPage />} />
            <Route path="/accounting/fixed-assets" element={<FixedAssetListPage />} />
            <Route path="/accounting/fixed-assets/new" element={<FixedAssetNewPage />} />
            <Route path="/accounting/fixed-assets/:id" element={<FixedAssetDetailPage />} />

            {/* Setup */}
            <Route path="/clients/new" element={<AddClientPage />} />
            <Route path="/setup/entity" element={<EntityPage />} />
            <Route path="/setup/company-settings" element={<CompanySettingsPage />} />
            <Route path="/setup/coa" element={<CoaListPage />} />
            <Route path="/setup/coa/:accountId/register" element={<AccountRegisterPage />} />
            <Route path="/setup/cost-centers" element={<CostCentersPage />} />
            <Route path="/setup/users" element={<UsersPage />} />

            {/* Payroll (placeholders) */}
            <Route path="/payroll/overview" element={<PayrollOverviewPage />} />
            <Route path="/payroll/pay-runs" element={<PayRunListPage />} />
            <Route path="/payroll/pay-runs/new" element={<PayRunNewPage />} />
            <Route path="/payroll/employees" element={<EmployeeListPage />} />
            <Route path="/payroll/employees/new" element={<EmployeeNewPage />} />
            <Route path="/payroll/employees/:id" element={<EmployeeDetailPage />} />
            <Route path="/payroll/contractors" element={<PayrollContractorsPage />} />
            <Route path="/payroll/taxes" element={<PayrollTaxesPage />} />
            <Route path="/payroll/compliance" element={<CompliancePage />} />

            {/* Inventory */}
            <Route path="/inventory/overview" element={<InventoryOverviewPage />} />
            <Route path="/inventory/items" element={<InventoryListPage />} />
            <Route path="/inventory/items/new" element={<InventoryNewPage />} />
            <Route path="/inventory/items/:id" element={<InventoryDetailPage />} />
            <Route path="/inventory/purchase-orders" element={<PurchaseOrderListPage />} />
            <Route path="/inventory/purchase-orders/new" element={<PurchaseOrderNewPage />} />
            <Route path="/inventory/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
            <Route path="/inventory/item-receipts" element={<ItemReceiptListPage />} />
            <Route path="/inventory/item-receipts/new" element={<ItemReceiptNewPage />} />
            <Route path="/inventory/sales-orders" element={<SalesOrderListPage />} />
            <Route path="/inventory/sales-orders/new" element={<SalesOrderNewPage />} />
            <Route path="/inventory/sales-orders/:id" element={<SalesOrderDetailPage />} />
            <Route path="/inventory/shipping-labels" element={<ShippingLabelListPage />} />
            <Route path="/inventory/shipping-labels/new" element={<ShippingLabelNewPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
