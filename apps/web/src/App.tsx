import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { KioskBorrowPage } from './pages/kiosk/KioskBorrowPage';
import { KioskPhotoBorrowPage } from './pages/kiosk/KioskPhotoBorrowPage';
import { KioskReturnPage } from './pages/kiosk/KioskReturnPage';
import { AdminLayout } from './layouts/AdminLayout';
import { KioskLayout } from './layouts/KioskLayout';
import { RequireAuth } from './components/RequireAuth';
import { DashboardPage } from './pages/admin/DashboardPage';
import { MasterImportPage } from './pages/admin/MasterImportPage';
import { EmployeesPage } from './pages/tools/EmployeesPage';
import { ItemsPage } from './pages/tools/ItemsPage';
import { HistoryPage } from './pages/tools/HistoryPage';
import { ClientsPage } from './pages/admin/ClientsPage';
import { KioskRedirect } from './components/KioskRedirect';

function App() {
  return (
    <Routes>
      <Route path="/" element={<KioskRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<KioskLayout />}>
        <Route path="/kiosk" element={<KioskRedirect />} />
        <Route path="/kiosk/tag" element={<KioskBorrowPage />} />
        <Route path="/kiosk/photo" element={<KioskPhotoBorrowPage />} />
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
        <Route path="tools">
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>
        <Route path="clients" element={<ClientsPage />} />
        <Route path="import" element={<MasterImportPage />} />
        {/* 後方互換性のため、既存パスも維持 */}
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  );
}

export default App;
