import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { KioskRedirect } from './components/KioskRedirect';
import { RequireAuth } from './components/RequireAuth';
import { INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED } from './features/part-measurement/inspection-drawing/inspectionDrawingPrintConstants';
import { CallAutoSwitchLayout } from './features/webrtc/components/CallAutoSwitchLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { KioskLayout } from './layouts/KioskLayout';
import { BackupConfigHistoryPage } from './pages/admin/BackupConfigHistoryPage';
import { BackupHistoryPage } from './pages/admin/BackupHistoryPage';
import { BackupRestorePage } from './pages/admin/BackupRestorePage';
import { BackupTargetsPage } from './pages/admin/BackupTargetsPage';
import { ClientsPage } from './pages/admin/ClientsPage';
import { CsvDashboardsPage } from './pages/admin/CsvDashboardsPage';
import { CsvImportPage } from './pages/admin/CsvImportPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { DgxResourceAdminPage } from './pages/admin/DgxResourceAdminPage';
import { GmailConfigPage } from './pages/admin/GmailConfigPage';
import { KioskDocumentsAdminPage } from './pages/admin/KioskDocumentsAdminPage';
import { KioskSettingsPage } from './pages/admin/KioskSettingsPage';
import { LoanReportPage } from './pages/admin/LoanReportPage';
import { LocalLlmAdminPage } from './pages/admin/LocalLlmAdminPage';
import { PalletMachineIllustrationsPage } from './pages/admin/PalletMachineIllustrationsPage';
import { PartMeasurementTemplatesPage } from './pages/admin/PartMeasurementTemplatesPage';
import { PhotoGallerySeedPage } from './pages/admin/PhotoGallerySeedPage';
import { PhotoLoanLabelReviewsPage } from './pages/admin/PhotoLoanLabelReviewsPage';
import { ProductionScheduleSettingsPage } from './pages/admin/ProductionScheduleSettingsPage';
import { SecurityPage } from './pages/admin/SecurityPage';
import { SelfInspectionOutOfToleranceReviewsPage } from './pages/admin/SelfInspectionOutOfToleranceReviewsPage';
import { SignageEmergencyPage } from './pages/admin/SignageEmergencyPage';
import { SignagePdfsPage } from './pages/admin/SignagePdfsPage';
import { SignagePreviewPage } from './pages/admin/SignagePreviewPage';
import { SignageSchedulesPage } from './pages/admin/SignageSchedulesPage';
import { VisualizationDashboardsPage } from './pages/admin/VisualizationDashboardsPage';
import { LoadBalancingOverviewChartPreviewPage } from './pages/dev/LoadBalancingOverviewChartPreviewPage';
import { KioskAssemblyHomePage } from './pages/kiosk/KioskAssemblyHomePage';
import { KioskAssemblyPage } from './pages/kiosk/KioskAssemblyPage';
import { KioskAssemblyProcedureOrderSettingsPage } from './pages/kiosk/KioskAssemblyProcedureOrderSettingsPage';
import { KioskAssemblyRecordApprovalPage } from './pages/kiosk/KioskAssemblyRecordApprovalPage';
import { KioskAssemblyTraceabilityPage } from './pages/kiosk/KioskAssemblyTraceabilityPage';
import { KioskBorrowPage } from './pages/kiosk/KioskBorrowPage';
import { KioskCallPage } from './pages/kiosk/KioskCallPage';
import { KioskDocumentsPage } from './pages/kiosk/KioskDocumentsPage';
import { KioskInstrumentBorrowPage } from './pages/kiosk/KioskInstrumentBorrowPage';
import { KioskMobilePalletVisualizationPage } from './pages/kiosk/KioskMobilePalletVisualizationPage';
import { KioskMobileShelfMasterPage } from './pages/kiosk/KioskMobileShelfMasterPage';
import { KioskMobileZero2wStatusPage } from './pages/kiosk/KioskMobileZero2wStatusPage';
import { KioskPalletVisualizationPage } from './pages/kiosk/KioskPalletVisualizationPage';
import { KioskPartMeasurementEditPage } from './pages/kiosk/KioskPartMeasurementEditPage';
import { KioskPartMeasurementFinalizedPage } from './pages/kiosk/KioskPartMeasurementFinalizedPage';
import { KioskPartMeasurementPage } from './pages/kiosk/KioskPartMeasurementPage';
import { KioskPartMeasurementTemplatePage } from './pages/kiosk/KioskPartMeasurementTemplatePage';
import { KioskPartMeasurementTemplatePickPage } from './pages/kiosk/KioskPartMeasurementTemplatePickPage';
import { KioskPhotoBorrowPage } from './pages/kiosk/KioskPhotoBorrowPage';
import { KioskRiggingAnalyticsPage } from './pages/kiosk/KioskRiggingAnalyticsPage';
import { KioskRiggingBorrowPage } from './pages/kiosk/KioskRiggingBorrowPage';
import { KioskSelfInspectionPage } from './pages/kiosk/KioskSelfInspectionPage';
import { KioskSelfInspectionRecordApprovalPage } from './pages/kiosk/KioskSelfInspectionRecordApprovalPage';
import { MobilePlacementPage } from './pages/kiosk/MobilePlacementPage';
import { MobilePlacementPartSearchPage } from './pages/kiosk/MobilePlacementPartSearchPage';
import { ProductionScheduleDueManagementPage } from './pages/kiosk/ProductionScheduleDueManagementPage';
import { ProductionScheduleLeaderOrderBoardPage } from './pages/kiosk/ProductionScheduleLeaderOrderBoardPage';
import { ProductionScheduleLoadBalancingPage } from './pages/kiosk/ProductionScheduleLoadBalancingPage';
import { ProductionScheduleManualOrderPage } from './pages/kiosk/ProductionScheduleManualOrderPage';
import { ProductionSchedulePage } from './pages/kiosk/ProductionSchedulePage';
import { ProductionScheduleProgressOverviewPage } from './pages/kiosk/ProductionScheduleProgressOverviewPage';
import { PurchaseOrderLookupPage } from './pages/kiosk/PurchaseOrderLookupPage';
import { LoginPage } from './pages/LoginPage';
import { SignageDisplayPage } from './pages/signage/SignageDisplayPage';
import { SignageLiteDisplayPage } from './pages/signage/SignageLiteDisplayPage';
import { AssemblyTorqueOverridePage } from './pages/tools/AssemblyTorqueOverridePage';
import { EmployeesPage } from './pages/tools/EmployeesPage';
import { HistoryPage } from './pages/tools/HistoryPage';
import { InspectionItemsPage } from './pages/tools/InspectionItemsPage';
import { InspectionRecordsPage } from './pages/tools/InspectionRecordsPage';
import { InstrumentTagsPage } from './pages/tools/InstrumentTagsPage';
import { ItemsPage } from './pages/tools/ItemsPage';
import { MachinesPage } from './pages/tools/MachinesPage';
import { MachinesUninspectedPage } from './pages/tools/MachinesUninspectedPage';
import { MeasuringInstrumentGenresPage } from './pages/tools/MeasuringInstrumentGenresPage';
import { MeasuringInstrumentsPage } from './pages/tools/MeasuringInstrumentsPage';
import { RiggingGearsPage } from './pages/tools/RiggingGearsPage';
import { TorqueWrenchesPage } from './pages/tools/TorqueWrenchesPage';
import { UnifiedItemsPage } from './pages/tools/UnifiedItemsPage';

const KioskInspectionDrawingCreatePreviewPage = lazy(() =>
  import('./pages/dev/KioskInspectionDrawingCreatePreviewPage').then((module) => ({
    default: module.KioskInspectionDrawingCreatePreviewPage
  }))
);
const KioskInspectionDrawingLibraryPreviewPage = lazy(() =>
  import('./pages/dev/KioskInspectionDrawingLibraryPreviewPage').then((module) => ({
    default: module.KioskInspectionDrawingLibraryPreviewPage
  }))
);
const KioskAssemblyLibraryPreviewPage = lazy(() =>
  import('./pages/dev/KioskAssemblyLibraryPreviewPage').then((module) => ({
    default: module.KioskAssemblyLibraryPreviewPage
  }))
);
const KioskAssemblyTemplateEditorPreviewPage = lazy(() =>
  import('./pages/dev/KioskAssemblyTemplateEditorPreviewPage').then((module) => ({
    default: module.KioskAssemblyTemplateEditorPreviewPage
  }))
);
const KioskInspectionDrawingPrintPreviewPage = lazy(() =>
  import('./pages/dev/KioskInspectionDrawingPrintPreviewPage').then((module) => ({
    default: module.KioskInspectionDrawingPrintPreviewPage
  }))
);
const KioskInspectionDrawingCreatePage = lazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingCreatePage').then((module) => ({
    default: module.KioskInspectionDrawingCreatePage
  }))
);
const KioskInspectionDrawingEditPage = lazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingEditPage').then((module) => ({
    default: module.KioskInspectionDrawingEditPage
  }))
);
const KioskInspectionDrawingLibraryPage = lazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingLibraryPage').then((module) => ({
    default: module.KioskInspectionDrawingLibraryPage
  }))
);
const KioskInspectionDrawingPrintPage = lazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingPrintPage').then((module) => ({
    default: module.KioskInspectionDrawingPrintPage
  }))
);
const KioskAssemblyTemplateEditorPage = lazy(() =>
  import('./pages/kiosk/KioskAssemblyTemplateEditorPage').then((module) => ({
    default: module.KioskAssemblyTemplateEditorPage
  }))
);
const KioskAssemblyWorkSessionPage = lazy(() =>
  import('./pages/kiosk/KioskAssemblyWorkSessionPage').then((module) => ({
    default: module.KioskAssemblyWorkSessionPage
  }))
);
const KioskSelfInspectionSessionPage = lazy(() =>
  import('./pages/kiosk/KioskSelfInspectionSessionPage').then((module) => ({
    default: module.KioskSelfInspectionSessionPage
  }))
);

function lazyRouteElement(element: ReactNode) {
  return <Suspense fallback={null}>{element}</Suspense>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<KioskRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<CallAutoSwitchLayout />}>
        <Route path="/signage" element={<SignageDisplayPage />} />
        <Route path="/signage-lite" element={<SignageLiteDisplayPage />} />
        <Route element={<KioskLayout />}>
          <Route path="/kiosk" element={<KioskRedirect />} />
          <Route path="/kiosk/tag" element={<KioskBorrowPage />} />
          <Route path="/kiosk/photo" element={<KioskPhotoBorrowPage />} />
          <Route path="/kiosk/instruments/borrow" element={<KioskInstrumentBorrowPage />} />
          <Route path="/kiosk/rigging/borrow" element={<KioskRiggingBorrowPage />} />
          <Route path="/kiosk/call" element={<KioskCallPage />} />
          <Route path="/kiosk/production-schedule" element={<ProductionSchedulePage />} />
          <Route path="/kiosk/production-schedule/manual-order" element={<ProductionScheduleManualOrderPage />} />
          <Route
            path="/kiosk/production-schedule/leader-order-board"
            element={<ProductionScheduleLeaderOrderBoardPage />}
          />
          <Route path="/kiosk/production-schedule/progress-overview" element={<ProductionScheduleProgressOverviewPage />} />
          <Route
            path="/kiosk/production-schedule/load-balancing"
            element={<ProductionScheduleLoadBalancingPage />}
          />
          <Route path="/kiosk/production-schedule/due-management" element={<ProductionScheduleDueManagementPage />} />
          <Route path="/kiosk/mobile-placement" element={<MobilePlacementPage />} />
          <Route path="/kiosk/mobile-placement/part-search" element={<MobilePlacementPartSearchPage />} />
          <Route path="/kiosk/mobile-placement/shelf-master" element={<KioskMobileShelfMasterPage />} />
          <Route path="/kiosk/mobile-placement/shelf-register" element={<Navigate to="/kiosk/mobile-placement/shelf-master" replace />} />
          <Route path="/kiosk/mobile-placement/zero2w-assignment" element={<Navigate to="/kiosk/mobile-placement/shelf-master" replace />} />
          <Route path="/kiosk/mobile-placement/zero2w-status" element={<KioskMobileZero2wStatusPage />} />
          <Route path="/kiosk/mobile-placement/pallet-viz" element={<KioskMobilePalletVisualizationPage />} />
          <Route path="/kiosk/mobile-placement/register" element={<Navigate to="/kiosk/mobile-placement" replace />} />
          <Route path="/kiosk/purchase-order-lookup" element={<PurchaseOrderLookupPage />} />
          <Route path="/kiosk/pallet-visualization" element={<KioskPalletVisualizationPage />} />
          <Route path="/kiosk/documents" element={<KioskDocumentsPage />} />
          <Route path="/kiosk/assembly" element={<KioskAssemblyHomePage />} />
          <Route path="/kiosk/assembly/library" element={<KioskAssemblyPage />} />
          <Route
            path="/kiosk/assembly/procedure-order-settings"
            element={<KioskAssemblyProcedureOrderSettingsPage />}
          />
          <Route path="/kiosk/assembly/record-approvals" element={<KioskAssemblyRecordApprovalPage />} />
          <Route path="/kiosk/assembly/traceability" element={<KioskAssemblyTraceabilityPage />} />
          <Route
            path="/kiosk/assembly/templates/new"
            element={lazyRouteElement(<KioskAssemblyTemplateEditorPage />)}
          />
          <Route
            path="/kiosk/assembly/templates/:templateId/edit"
            element={lazyRouteElement(<KioskAssemblyTemplateEditorPage />)}
          />
          <Route
            path="/kiosk/assembly/work-sessions/:sessionId"
            element={lazyRouteElement(<KioskAssemblyWorkSessionPage />)}
          />
          <Route path="/kiosk/part-measurement" element={<KioskPartMeasurementPage />} />
          <Route path="/kiosk/part-measurement/self-inspection" element={<KioskSelfInspectionPage />} />
          <Route
            path="/kiosk/part-measurement/self-inspection/record-approvals"
            element={<KioskSelfInspectionRecordApprovalPage />}
          />
          <Route
            path="/kiosk/part-measurement/self-inspection/start"
            element={lazyRouteElement(<KioskSelfInspectionSessionPage />)}
          />
          <Route
            path="/kiosk/part-measurement/self-inspection/sessions/:sessionId"
            element={lazyRouteElement(<KioskSelfInspectionSessionPage />)}
          />
          <Route
            path="/kiosk/part-measurement/self-inspection/sessions/:sessionId/inspector"
            element={lazyRouteElement(<KioskSelfInspectionSessionPage mode="inspector" />)}
          />
          <Route path="/kiosk/part-measurement/edit/:sheetId" element={<KioskPartMeasurementEditPage />} />
          <Route path="/kiosk/part-measurement/template/pick" element={<KioskPartMeasurementTemplatePickPage />} />
          <Route path="/kiosk/part-measurement/template/new" element={<KioskPartMeasurementTemplatePage />} />
          <Route path="/kiosk/part-measurement/finalized" element={<KioskPartMeasurementFinalizedPage />} />
          <Route
            path="/kiosk/part-measurement/inspection"
            element={lazyRouteElement(<KioskInspectionDrawingLibraryPage />)}
          />
          <Route
            path="/kiosk/part-measurement/inspection/create"
            element={lazyRouteElement(<KioskInspectionDrawingCreatePage />)}
          />
          <Route
            path="/kiosk/part-measurement/inspection/templates/:templateId/edit"
            element={lazyRouteElement(<KioskInspectionDrawingCreatePage />)}
          />
          <Route
            path="/kiosk/part-measurement/inspection/edit/:sheetId"
            element={lazyRouteElement(<KioskInspectionDrawingEditPage />)}
          />
          <Route path="/kiosk/rigging-analytics" element={<KioskRiggingAnalyticsPage />} />
          {import.meta.env.DEV ? (
            <>
              <Route
                path="/dev/kiosk-inspection-drawing-library"
                element={lazyRouteElement(<KioskInspectionDrawingLibraryPreviewPage />)}
              />
              <Route
                path="/dev/kiosk-inspection-drawing-create"
                element={lazyRouteElement(<KioskInspectionDrawingCreatePreviewPage />)}
              />
              <Route
                path="/dev/kiosk-assembly-library"
                element={lazyRouteElement(<KioskAssemblyLibraryPreviewPage />)}
              />
              <Route
                path="/dev/kiosk-assembly-template-editor"
                element={lazyRouteElement(<KioskAssemblyTemplateEditorPreviewPage />)}
              />
            </>
          ) : null}
        </Route>
      </Route>
      {import.meta.env.DEV ? (
        <>
          <Route path="/dev/load-balancing-overview-chart" element={<LoadBalancingOverviewChartPreviewPage />} />
          <Route
            path="/dev/kiosk-inspection-drawing-print"
            element={lazyRouteElement(<KioskInspectionDrawingPrintPreviewPage />)}
          />
        </>
      ) : null}
      {INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED ? (
        <>
          <Route
            path="/kiosk/part-measurement/inspection/templates/:templateId/print"
            element={lazyRouteElement(<KioskInspectionDrawingPrintPage />)}
          />
          <Route
            path="/kiosk/part-measurement/inspection/paper-reports/:reportId/print"
            element={lazyRouteElement(<KioskInspectionDrawingPrintPage />)}
          />
        </>
      ) : null}
      <Route
        path="/preview"
        element={<AdminLayout />}
      >
        <Route path="import" element={<CsvImportPage />} />
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
          <Route path="dgx-resource" element={<DgxResourceAdminPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="unified" element={<UnifiedItemsPage />} />
          <Route path="rigging-gears" element={<RiggingGearsPage />} />
          <Route path="inspection-items" element={<InspectionItemsPage />} />
          <Route path="instrument-tags" element={<InstrumentTagsPage />} />
          <Route path="inspection-records" element={<InspectionRecordsPage />} />
          <Route path="measuring-instruments" element={<MeasuringInstrumentsPage />} />
          <Route path="torque-wrenches" element={<TorqueWrenchesPage />} />
          <Route path="assembly-torque-override" element={<AssemblyTorqueOverridePage />} />
          <Route path="measuring-instrument-genres" element={<MeasuringInstrumentGenresPage />} />
          <Route path="part-measurement-templates" element={<PartMeasurementTemplatesPage />} />
          <Route path="machines" element={<MachinesPage />} />
          <Route path="machines-uninspected" element={<MachinesUninspectedPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>
        <Route path="clients" element={<ClientsPage />} />
        <Route path="kiosk-settings" element={<KioskSettingsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="import" element={<CsvImportPage />} />
        <Route path="backup">
          <Route path="targets" element={<BackupTargetsPage />} />
          <Route path="config-history" element={<BackupConfigHistoryPage />} />
          <Route path="history" element={<BackupHistoryPage />} />
          <Route path="restore" element={<BackupRestorePage />} />
        </Route>
        <Route path="imports">
          <Route path="schedule" element={<Navigate to="/admin/import" replace />} />
        </Route>
        <Route path="csv-dashboards" element={<CsvDashboardsPage />} />
        <Route path="production-schedule-settings" element={<ProductionScheduleSettingsPage />} />
        <Route
          path="part-measurement/self-inspection-reviews"
          element={<SelfInspectionOutOfToleranceReviewsPage />}
        />
        <Route path="visualization-dashboards" element={<VisualizationDashboardsPage />} />
        <Route path="pallet-machine-illustrations" element={<PalletMachineIllustrationsPage />} />
        <Route path="gmail">
          <Route path="config" element={<GmailConfigPage />} />
        </Route>
        <Route path="reports">
          <Route path="loan-report" element={<LoanReportPage />} />
        </Route>
        <Route path="local-llm" element={<LocalLlmAdminPage />} />
        <Route path="dgx-resource" element={<DgxResourceAdminPage />} />
        <Route path="photo-loan-label-reviews" element={<PhotoLoanLabelReviewsPage />} />
        <Route path="photo-gallery-seed" element={<PhotoGallerySeedPage />} />
        <Route path="kiosk-documents" element={<KioskDocumentsAdminPage />} />
        <Route path="signage">
          <Route path="schedules" element={<SignageSchedulesPage />} />
          <Route path="pdfs" element={<SignagePdfsPage />} />
          <Route path="emergency" element={<SignageEmergencyPage />} />
          <Route path="preview" element={<SignagePreviewPage />} />
        </Route>
        {/* 後方互換性のため、既存パスも維持 */}
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="inspection-items" element={<InspectionItemsPage />} />
        <Route path="instrument-tags" element={<InstrumentTagsPage />} />
        <Route path="inspection-records" element={<InspectionRecordsPage />} />
        <Route path="measuring-instruments" element={<MeasuringInstrumentsPage />} />
        <Route path="measuring-instrument-genres" element={<MeasuringInstrumentGenresPage />} />
        <Route path="machines" element={<MachinesPage />} />
        <Route path="machines-uninspected" element={<MachinesUninspectedPage />} />
        <Route path="rigging-gears" element={<RiggingGearsPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  );
}

export default App;
