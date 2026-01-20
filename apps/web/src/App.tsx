import { Navigate, Route, Routes } from 'react-router-dom';

import { KioskRedirect } from './components/KioskRedirect';
import { RequireAuth } from './components/RequireAuth';
import { AdminLayout } from './layouts/AdminLayout';
import { KioskLayout } from './layouts/KioskLayout';
import { BackupHistoryPage } from './pages/admin/BackupHistoryPage';
import { BackupRestorePage } from './pages/admin/BackupRestorePage';
import { BackupTargetsPage } from './pages/admin/BackupTargetsPage';
import { ClientsPage } from './pages/admin/ClientsPage';
import { CsvDashboardsPage } from './pages/admin/CsvDashboardsPage';
import { CsvImportSchedulePage } from './pages/admin/CsvImportSchedulePage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { GmailConfigPage } from './pages/admin/GmailConfigPage';
import { MasterImportPage } from './pages/admin/MasterImportPage';
import { SecurityPage } from './pages/admin/SecurityPage';
import { SignageEmergencyPage } from './pages/admin/SignageEmergencyPage';
import { SignagePdfsPage } from './pages/admin/SignagePdfsPage';
import { SignageSchedulesPage } from './pages/admin/SignageSchedulesPage';
import { KioskBorrowPage } from './pages/kiosk/KioskBorrowPage';
import { KioskCallPage } from './pages/kiosk/KioskCallPage';
import { KioskInstrumentBorrowPage } from './pages/kiosk/KioskInstrumentBorrowPage';
import { KioskPhotoBorrowPage } from './pages/kiosk/KioskPhotoBorrowPage';
import { KioskRiggingBorrowPage } from './pages/kiosk/KioskRiggingBorrowPage';
import { ProductionSchedulePage } from './pages/kiosk/ProductionSchedulePage';
import { LoginPage } from './pages/LoginPage';
import { SignageDisplayPage } from './pages/signage/SignageDisplayPage';
import { EmployeesPage } from './pages/tools/EmployeesPage';
import { HistoryPage } from './pages/tools/HistoryPage';
import { InspectionItemsPage } from './pages/tools/InspectionItemsPage';
import { InspectionRecordsPage } from './pages/tools/InspectionRecordsPage';
import { InstrumentTagsPage } from './pages/tools/InstrumentTagsPage';
import { ItemsPage } from './pages/tools/ItemsPage';
import { MeasuringInstrumentsPage } from './pages/tools/MeasuringInstrumentsPage';
import { RiggingGearsPage } from './pages/tools/RiggingGearsPage';
import { UnifiedItemsPage } from './pages/tools/UnifiedItemsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<KioskRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signage" element={<SignageDisplayPage />} />
      {/* 開発用: UI確認のための一時的なルート */}
      <Route
        path="/preview"
        element={<AdminLayout />}
      >
        <Route path="import" element={<MasterImportPage />} />
      </Route>
      <Route element={<KioskLayout />}>
        <Route path="/kiosk" element={<KioskRedirect />} />
        <Route path="/kiosk/tag" element={<KioskBorrowPage />} />
        <Route path="/kiosk/photo" element={<KioskPhotoBorrowPage />} />
        <Route path="/kiosk/instruments/borrow" element={<KioskInstrumentBorrowPage />} />
        <Route path="/kiosk/rigging/borrow" element={<KioskRiggingBorrowPage />} />
        <Route path="/kiosk/call" element={<KioskCallPage />} />
        <Route path="/kiosk/production-schedule" element={<ProductionSchedulePage />} />
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
          <Route path="rigging-gears" element={<RiggingGearsPage />} />
          <Route path="inspection-items" element={<InspectionItemsPage />} />
          <Route path="instrument-tags" element={<InstrumentTagsPage />} />
          <Route path="inspection-records" element={<InspectionRecordsPage />} />
          <Route path="measuring-instruments" element={<MeasuringInstrumentsPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>
        <Route path="clients" element={<ClientsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="import" element={<MasterImportPage />} />
        <Route path="backup">
          <Route path="targets" element={<BackupTargetsPage />} />
          <Route path="history" element={<BackupHistoryPage />} />
          <Route path="restore" element={<BackupRestorePage />} />
        </Route>
        <Route path="imports">
          <Route path="schedule" element={<CsvImportSchedulePage />} />
        </Route>
        <Route path="csv-dashboards" element={<CsvDashboardsPage />} />
        <Route path="gmail">
          <Route path="config" element={<GmailConfigPage />} />
        </Route>
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
        <Route path="rigging-gears" element={<RiggingGearsPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  );
}

export default App;
