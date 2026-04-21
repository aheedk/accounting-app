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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="/journal" element={<JournalListPage />} />
            <Route path="/journal/new" element={<JournalNewPage />} />
            <Route path="/journal/:id" element={<JournalDetailPage />} />
            <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
            <Route path="/settings/coa" element={<CoaListPage />} />
            <Route path="/settings/periods" element={<PeriodsPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
