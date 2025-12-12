import { Navigate, Route, Routes } from 'react-router-dom';

import { KioskRedirect } from './components/KioskRedirect';
import { RequireAuth } from './components/RequireAuth';
import { AdminLayout } from './layouts/AdminLayout';
import { KioskLayout } from './layouts/KioskLayout';
import { ClientsPage } from './pages/admin/ClientsPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { MasterImportPage } from './pages/admin/MasterImportPage';
import { SignageEmergencyPage } from './pages/admin/SignageEmergencyPage';
import { SignagePdfsPage } from './pages/admin/SignagePdfsPage';
import { SignageSchedulesPage } from './pages/admin/SignageSchedulesPage';
import { KioskBorrowPage } from './pages/kiosk/KioskBorrowPage';
import { KioskInstrumentBorrowPage } from './pages/kiosk/KioskInstrumentBorrowPage';
import { KioskPhotoBorrowPage } from './pages/kiosk/KioskPhotoBorrowPage';
import { KioskRiggingBorrowPage } from './pages/kiosk/KioskRiggingBorrowPage';
import { LoginPage } from './pages/LoginPage';
import { SignageDisplayPage } from './pages/signage/SignageDisplayPage';
import { EmployeesPage } from './pages/tools/EmployeesPage';
import { HistoryPage } from './pages/tools/HistoryPage';
import { InspectionItemsPage } from './pages/tools/InspectionItemsPage';
import { InspectionRecordsPage } from './pages/tools/InspectionRecordsPage';
import { InstrumentTagsPage } from './pages/tools/InstrumentTagsPage';
import { ItemsPage } from './pages/tools/ItemsPage';
import { MeasuringInstrumentsPage } from './pages/tools/MeasuringInstrumentsPage';
import { UnifiedItemsPage } from './pages/tools/UnifiedItemsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<KioskRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signage" element={<SignageDisplayPage />} />
      <Route element={<KioskLayout />}>
        <Route path="/kiosk" element={<KioskRedirect />} />
        <Route path="/kiosk/tag" element={<KioskBorrowPage />} />
        <Route path="/kiosk/photo" element={<KioskPhotoBorrowPage />} />
        <Route path="/kiosk/instruments/borrow" element={<KioskInstrumentBorrowPage />} />
        <Route path="/kiosk/rigging/borrow" element={<KioskRiggingBorrowPage />} />
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
          <Route path="unified" element={<UnifiedItemsPage />} />
          <Route path="inspection-items" element={<InspectionItemsPage />} />
          <Route path="instrument-tags" element={<InstrumentTagsPage />} />
          <Route path="inspection-records" element={<InspectionRecordsPage />} />
          <Route path="measuring-instruments" element={<MeasuringInstrumentsPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>
        <Route path="clients" element={<ClientsPage />} />
        <Route path="import" element={<MasterImportPage />} />
        <Route path="signage">
          <Route path="schedules" element={<SignageSchedulesPage />} />
          <Route path="pdfs" element={<SignagePdfsPage />} />
          <Route path="emergency" element={<SignageEmergencyPage />} />
        </Route>
        {/* 後方互換性のため、既存パスも維持 */}
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="inspection-items" element={<InspectionItemsPage />} />
        <Route path="instrument-tags" element={<InstrumentTagsPage />} />
        <Route path="inspection-records" element={<InspectionRecordsPage />} />
        <Route path="measuring-instruments" element={<MeasuringInstrumentsPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  );
}

export default App;
