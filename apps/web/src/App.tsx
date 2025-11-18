import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { KioskBorrowPage } from './pages/kiosk/KioskBorrowPage';
import { KioskReturnPage } from './pages/kiosk/KioskReturnPage';
import { AdminLayout } from './layouts/AdminLayout';
import { KioskLayout } from './layouts/KioskLayout';
import { RequireAuth } from './components/RequireAuth';
import { DashboardPage } from './pages/admin/DashboardPage';
import { EmployeesPage } from './pages/admin/EmployeesPage';
import { ItemsPage } from './pages/admin/ItemsPage';
import { HistoryPage } from './pages/admin/HistoryPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/kiosk" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<KioskLayout />}>
        <Route path="/kiosk" element={<KioskBorrowPage />} />
        <Route path="/kiosk/return" element={<KioskReturnPage />} />
      </Route>
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  );
}

export default App;
