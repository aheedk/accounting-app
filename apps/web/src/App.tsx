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
import TaxCodesPage from '@/pages/settings/TaxCodesPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
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
            <Route path="/journal" element={<JournalListPage />} />
            <Route path="/journal/new" element={<JournalNewPage />} />
            <Route path="/journal/:id" element={<JournalDetailPage />} />
            <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
            <Route path="/reports/aging" element={<AgingReportPage />} />
            <Route path="/settings/coa" element={<CoaListPage />} />
            <Route path="/settings/tax-codes" element={<TaxCodesPage />} />
            <Route path="/settings/periods" element={<PeriodsPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
