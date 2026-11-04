import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { useDeployStatus } from './api/hooks';
import { HermesFloatingChat } from './components/hermes/HermesFloatingChat';
import { HermesPageContextProvider } from './components/hermes/HermesPageContext';
import { KioskRedirect } from './components/KioskRedirect';
import { RequireAuth } from './components/RequireAuth';
import { RouteLoadingScreen } from './components/RouteLoadingScreen';
import { readProductionBuildConfig } from './config/productionBuildConfig';
import { kioskAssemblyLibraryPath, parseAssemblyProcedureOrderSettingsSearch } from './features/assembly';
import { KIOSK_ASSEMBLY_CHECK_SHEETS_PATH, KIOSK_ASSEMBLY_CHECK_SHEET_PATH, KIOSK_ASSEMBLY_MANUALS_PATH, KIOSK_ASSEMBLY_MANUALS_WORKSHOP_PATH } from './features/assembly/assemblyRoutes';
import { kioskLazy } from './features/kiosk/kioskLazyPreload';
import { KioskScreenWatchHost } from './features/kiosk/screen-watch/KioskScreenWatchHost';
import { useKioskSeamlessWebUpdate } from './features/kiosk/useKioskSeamlessWebUpdate';
import { registerMobileAppShell } from './features/mobile-app-shell/registerMobileAppShell';
import { PlacementDeleteSyncJob } from './features/mobile-placement/part-search/offline/PlacementDeleteSyncJob';
import { MobileSyncProvider } from './features/mobile-placement/sync/MobileSyncProvider';
import { INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED } from './features/part-measurement/inspection-drawing/inspectionDrawingPrintConstants';
import { CallAutoSwitchLayout } from './features/webrtc/components/CallAutoSwitchLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { KioskLayout } from './layouts/KioskLayout';
import { KioskAssemblyCheckSheetPage } from './pages/kiosk/KioskAssemblyCheckSheetPage';
import { KioskAssemblyCheckSheetsPage } from './pages/kiosk/KioskAssemblyCheckSheetsPage';
import { KioskAssemblyHomePage } from './pages/kiosk/KioskAssemblyHomePage';
import { KioskAssemblyManualsPage } from './pages/kiosk/KioskAssemblyManualsPage';
import { KioskAssemblyManualsWorkshopPage } from './pages/kiosk/KioskAssemblyManualsWorkshopPage';
import { KioskAssemblyPage } from './pages/kiosk/KioskAssemblyPage';
import { KioskAssemblyRecordApprovalPage } from './pages/kiosk/KioskAssemblyRecordApprovalPage';
import { KioskAssemblyTraceabilityPage } from './pages/kiosk/KioskAssemblyTraceabilityPage';
import { KioskBorrowPage } from './pages/kiosk/KioskBorrowPage';
import { KioskCallPage } from './pages/kiosk/KioskCallPage';
import { KioskDocumentsPage } from './pages/kiosk/KioskDocumentsPage';
import { KioskHaizenPage } from './pages/kiosk/KioskHaizenPage';
import { KioskHaizenTrailPage } from './pages/kiosk/KioskHaizenTrailPage';
import { KioskHaizenVerifyHistoryPage } from './pages/kiosk/KioskHaizenVerifyHistoryPage';
import { KioskInstrumentBorrowPage } from './pages/kiosk/KioskInstrumentBorrowPage';
import { KioskItemInventoryDashboardPage } from './pages/kiosk/KioskItemInventoryDashboardPage';
import { KioskItemInventoryPage } from './pages/kiosk/KioskItemInventoryPage';
import { KioskItemInventorySettingsPage } from './pages/kiosk/KioskItemInventorySettingsPage';
import { KioskMachineSignalPage } from './pages/kiosk/KioskMachineSignalPage';
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
import { KioskPortalPage } from './pages/kiosk/KioskPortalPage';
import { KioskProcedureBoardPage } from './pages/kiosk/KioskProcedureBoardPage';
import { KioskRiggingAnalyticsPage } from './pages/kiosk/KioskRiggingAnalyticsPage';
import { KioskRiggingBorrowPage } from './pages/kiosk/KioskRiggingBorrowPage';
import { KioskSelfInspectionPage } from './pages/kiosk/KioskSelfInspectionPage';
import { KioskSelfInspectionRecordApprovalPage } from './pages/kiosk/KioskSelfInspectionRecordApprovalPage';
import { KioskSelfInspectionReductionPage } from './pages/kiosk/KioskSelfInspectionReductionPage';
import { KioskTagDeskPage } from './pages/kiosk/KioskTagDeskPage';
import { MobilePlacementPage } from './pages/kiosk/MobilePlacementPage';
import { MobilePlacementPartSearchPage } from './pages/kiosk/MobilePlacementPartSearchPage';
import { ProductionScheduleDueManagementPage } from './pages/kiosk/ProductionScheduleDueManagementPage';
import { ProductionScheduleGrindingPlanningBoardPage } from './pages/kiosk/ProductionScheduleGrindingPlanningBoardPage';
import { ProductionScheduleLeaderOrderBoardPage } from './pages/kiosk/ProductionScheduleLeaderOrderBoardPage';
import { ProductionScheduleLoadBalancingPage } from './pages/kiosk/ProductionScheduleLoadBalancingPage';
import { ProductionScheduleManualOrderPage } from './pages/kiosk/ProductionScheduleManualOrderPage';
import { ProductionSchedulePage } from './pages/kiosk/ProductionSchedulePage';
import { ProductionScheduleProgressOverviewPage } from './pages/kiosk/ProductionScheduleProgressOverviewPage';
import { PurchaseOrderLookupPage } from './pages/kiosk/PurchaseOrderLookupPage';
import { LoginPage } from './pages/LoginPage';
import { SignageDisplayPage } from './pages/signage/SignageDisplayPage';
import { SignageLiteDisplayPage } from './pages/signage/SignageLiteDisplayPage';

const BackupConfigHistoryPage = lazy(() =>
  import('./pages/admin/BackupConfigHistoryPage').then((module) => ({ default: module.BackupConfigHistoryPage }))
);
const BackupHistoryPage = lazy(() =>
  import('./pages/admin/BackupHistoryPage').then((module) => ({ default: module.BackupHistoryPage }))
);
const BackupRestorePage = lazy(() =>
  import('./pages/admin/BackupRestorePage').then((module) => ({ default: module.BackupRestorePage }))
);
const BackupTargetsPage = lazy(() =>
  import('./pages/admin/BackupTargetsPage').then((module) => ({ default: module.BackupTargetsPage }))
);
const ClientsPage = lazy(() =>
  import('./pages/admin/ClientsPage').then((module) => ({ default: module.ClientsPage }))
);
const CsvImportPage = lazy(() =>
  import('./pages/admin/CsvImportPage').then((module) => ({ default: module.CsvImportPage }))
);
const DashboardPage = lazy(() =>
  import('./pages/admin/DashboardPage').then((module) => ({ default: module.DashboardPage }))
);
const DataBoardsPage = lazy(() =>
  import('./pages/admin/DataBoardsPage').then((module) => ({ default: module.DataBoardsPage }))
);
const DgxResourceAdminPage = lazy(() =>
  import('./pages/admin/DgxResourceAdminPage').then((module) => ({ default: module.DgxResourceAdminPage }))
);
const GmailConfigPage = lazy(() =>
  import('./pages/admin/GmailConfigPage').then((module) => ({ default: module.GmailConfigPage }))
);
const KioskDocumentsAdminPage = lazy(() =>
  import('./pages/admin/KioskDocumentsAdminPage').then((module) => ({ default: module.KioskDocumentsAdminPage }))
);
const KioskSettingsPage = lazy(() =>
  import('./pages/admin/KioskSettingsPage').then((module) => ({ default: module.KioskSettingsPage }))
);
const LoanReportPage = lazy(() =>
  import('./pages/admin/LoanReportPage').then((module) => ({ default: module.LoanReportPage }))
);
const LocalLlmAdminPage = lazy(() =>
  import('./pages/admin/LocalLlmAdminPage').then((module) => ({ default: module.LocalLlmAdminPage }))
);
const MachineSignalAdminPage = lazy(() =>
  import('./pages/admin/MachineSignalAdminPage').then((module) => ({ default: module.MachineSignalAdminPage }))
);
const PalletMachineIllustrationsPage = lazy(() =>
  import('./pages/admin/PalletMachineIllustrationsPage').then((module) => ({ default: module.PalletMachineIllustrationsPage }))
);
const PartMeasurementTemplatesPage = lazy(() =>
  import('./pages/admin/PartMeasurementTemplatesPage').then((module) => ({ default: module.PartMeasurementTemplatesPage }))
);
const PhotoGallerySeedPage = lazy(() =>
  import('./pages/admin/PhotoGallerySeedPage').then((module) => ({ default: module.PhotoGallerySeedPage }))
);
const PhotoLoanLabelReviewsPage = lazy(() =>
  import('./pages/admin/PhotoLoanLabelReviewsPage').then((module) => ({ default: module.PhotoLoanLabelReviewsPage }))
);
const PlacementPhotosPage = lazy(() =>
  import('./pages/admin/PlacementPhotosPage').then((module) => ({ default: module.PlacementPhotosPage }))
);
const ProductionScheduleSettingsPage = lazy(() =>
  import('./pages/admin/ProductionScheduleSettingsPage').then((module) => ({ default: module.ProductionScheduleSettingsPage }))
);
const RaspiInventoryPage = lazy(() =>
  import('./pages/admin/RaspiInventoryPage').then((module) => ({ default: module.RaspiInventoryPage }))
);
const SecurityPage = lazy(() =>
  import('./pages/admin/SecurityPage').then((module) => ({ default: module.SecurityPage }))
);
const SelfInspectionOutOfToleranceReviewsPage = lazy(() =>
  import('./pages/admin/SelfInspectionOutOfToleranceReviewsPage').then((module) => ({ default: module.SelfInspectionOutOfToleranceReviewsPage }))
);
const SignageHubPage = lazy(() =>
  import('./pages/admin/SignageHubPage').then((module) => ({ default: module.SignageHubPage }))
);
const WatchCameraPage = lazy(() =>
  import('./pages/admin/WatchCameraPage').then((module) => ({ default: module.WatchCameraPage }))
);
const AssemblyTorqueOverridePage = lazy(() =>
  import('./pages/tools/AssemblyTorqueOverridePage').then((module) => ({ default: module.AssemblyTorqueOverridePage }))
);
const HistoryPage = lazy(() =>
  import('./pages/tools/HistoryPage').then((module) => ({ default: module.HistoryPage }))
);
const InspectionItemsPage = lazy(() =>
  import('./pages/tools/InspectionItemsPage').then((module) => ({ default: module.InspectionItemsPage }))
);
const InspectionRecordsPage = lazy(() =>
  import('./pages/tools/InspectionRecordsPage').then((module) => ({ default: module.InspectionRecordsPage }))
);
const MachinesPage = lazy(() =>
  import('./pages/tools/MachinesPage').then((module) => ({ default: module.MachinesPage }))
);
const MachinesUninspectedPage = lazy(() =>
  import('./pages/tools/MachinesUninspectedPage').then((module) => ({ default: module.MachinesUninspectedPage }))
);
const MeasuringInstrumentGenresPage = lazy(() =>
  import('./pages/tools/MeasuringInstrumentGenresPage').then((module) => ({ default: module.MeasuringInstrumentGenresPage }))
);
const MovedToKioskTagDeskPage = lazy(() =>
  import('./pages/tools/MovedToKioskTagDeskPage').then((module) => ({ default: module.MovedToKioskTagDeskPage }))
);
const TorqueWrenchesPage = lazy(() =>
  import('./pages/tools/TorqueWrenchesPage').then((module) => ({ default: module.TorqueWrenchesPage }))
);

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
const KioskAssemblyHomePreviewPage = lazy(() =>
  import('./pages/dev/KioskAssemblyHomePreviewPage').then((module) => ({
    default: module.KioskAssemblyHomePreviewPage
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
const KioskInspectionDrawingCreatePage = kioskLazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingCreatePage').then((module) => ({
    default: module.KioskInspectionDrawingCreatePage
  }))
);
const KioskInspectionDrawingEditPage = kioskLazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingEditPage').then((module) => ({
    default: module.KioskInspectionDrawingEditPage
  }))
);
const KioskInspectionDrawingLibraryPage = kioskLazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingLibraryPage').then((module) => ({
    default: module.KioskInspectionDrawingLibraryPage
  }))
);
const KioskInspectionDrawingPrintPage = kioskLazy(() =>
  import('./pages/kiosk/KioskInspectionDrawingPrintPage').then((module) => ({
    default: module.KioskInspectionDrawingPrintPage
  }))
);
const KioskAssemblyTemplateEditorPage = kioskLazy(() =>
  import('./pages/kiosk/KioskAssemblyTemplateEditorPage').then((module) => ({
    default: module.KioskAssemblyTemplateEditorPage
  }))
);
const KioskAssemblyProcedureDocumentEditorPage = kioskLazy(() =>
  import('./pages/kiosk/KioskAssemblyProcedureDocumentEditorPage').then((module) => ({
    default: module.KioskAssemblyProcedureDocumentEditorPage
  }))
);
const KioskAssemblyWorkSessionPage = kioskLazy(() =>
  import('./pages/kiosk/KioskAssemblyWorkSessionPage').then((module) => ({
    default: module.KioskAssemblyWorkSessionPage
  }))
);
const KioskAssemblyTrainingPage = kioskLazy(() =>
  import('./pages/kiosk/KioskAssemblyTrainingPage').then((module) => ({
    default: module.KioskAssemblyTrainingPage
  }))
);
const KioskSelfInspectionSessionPage = kioskLazy(() =>
  import('./pages/kiosk/KioskSelfInspectionSessionPage').then((module) => ({
    default: module.KioskSelfInspectionSessionPage
  }))
);
const KioskWorkInstructionEditorPage = kioskLazy(() =>
  import('./pages/kiosk/KioskWorkInstructionEditorPage').then((module) => ({
    default: module.KioskWorkInstructionEditorPage
  }))
);

const MobileScanBenchPage = lazy(() =>
  import('./pages/kiosk/MobileScanBenchPage').then((module) => ({ default: module.MobileScanBenchPage }))
);

function lazyRouteElement(element: ReactNode) {
  return <Suspense fallback={<RouteLoadingScreen />}>{element}</Suspense>;
}

function App() {
  const { pathname } = useLocation();
  useEffect(() => registerMobileAppShell(pathname), [pathname]);
  const { isDevelopment } = readProductionBuildConfig();
  return (
    <HermesPageContextProvider>
      <Routes>
      <Route path="/kiosk/mobile-placement/scan-bench" element={lazyRouteElement(<MobileScanBenchPage />)} />
      <Route path="/" element={<KioskRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<CallAutoSwitchLayout />}>
        <Route path="/signage" element={<SignageDisplayPage />} />
        <Route path="/signage-lite" element={<SignageLiteDisplayPage />} />
        <Route element={<KioskLayout />}>
          <Route path="/kiosk" element={<KioskRedirect />} />
          <Route path="/kiosk/portal" element={<KioskPortalPage />} />
          <Route path="/kiosk/procedure-board" element={<KioskProcedureBoardPage />} />
          <Route path="/kiosk/procedure-board/:procedureId" element={<KioskProcedureBoardPage />} />
          <Route path="/kiosk/tag" element={<KioskBorrowPage />} />
          <Route path="/kiosk/inventory" element={<KioskItemInventoryPage />} />
          <Route path="/kiosk/inventory/dashboard" element={<KioskItemInventoryDashboardPage />} />
          <Route path="/kiosk/inventory/settings" element={<KioskItemInventorySettingsPage />} />
          <Route path="/kiosk/tag-desk" element={<KioskTagDeskPage />} />
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
          <Route
            path="/kiosk/production-schedule/planning-board"
            element={<ProductionScheduleGrindingPlanningBoardPage />}
          />
          <Route element={<MobileSyncProvider><PlacementDeleteSyncJob /><Outlet /></MobileSyncProvider>}>
            <Route path="/kiosk/inventory/haizen" element={<KioskHaizenPage />} />
            <Route path="/kiosk/inventory/haizen/verify-history" element={<KioskHaizenVerifyHistoryPage />} />
            <Route path="/kiosk/inventory/haizen/trail" element={<KioskHaizenTrailPage />} />
            <Route path="/kiosk/mobile-placement" element={<MobilePlacementPage />} />
            <Route path="/kiosk/mobile-placement/part-search" element={<MobilePlacementPartSearchPage />} />
            <Route path="/kiosk/mobile-placement/shelf-master" element={<KioskMobileShelfMasterPage />} />
            <Route path="/kiosk/mobile-placement/shelf-register" element={<Navigate to="/kiosk/mobile-placement/shelf-master" replace />} />
            <Route path="/kiosk/mobile-placement/zero2w-assignment" element={<Navigate to="/kiosk/mobile-placement/shelf-master" replace />} />
            <Route path="/kiosk/mobile-placement/zero2w-status" element={<KioskMobileZero2wStatusPage />} />
            <Route path="/kiosk/mobile-placement/pallet-viz" element={<KioskMobilePalletVisualizationPage />} />
            <Route path="/kiosk/mobile-placement/register" element={<Navigate to="/kiosk/mobile-placement" replace />} />
            <Route path="/kiosk/purchase-order-lookup" element={<PurchaseOrderLookupPage />} />
          </Route>
          <Route path="/kiosk/pallet-visualization" element={<KioskPalletVisualizationPage />} />
          <Route path="/kiosk/documents" element={<KioskDocumentsPage />} />
          <Route path={KIOSK_ASSEMBLY_CHECK_SHEETS_PATH} element={<KioskAssemblyCheckSheetsPage />} />
          <Route path={KIOSK_ASSEMBLY_CHECK_SHEET_PATH} element={<KioskAssemblyCheckSheetPage />} />
          <Route path="/kiosk/assembly" element={<KioskAssemblyHomePage />} />
          <Route path={KIOSK_ASSEMBLY_MANUALS_PATH} element={<KioskAssemblyManualsPage />} />
          <Route path={KIOSK_ASSEMBLY_MANUALS_WORKSHOP_PATH} element={<KioskAssemblyManualsWorkshopPage />} />
          <Route path="/kiosk/assembly/training" element={lazyRouteElement(<KioskAssemblyTrainingPage />)} />
          <Route path="/kiosk/assembly/library" element={<KioskAssemblyPage />} />
          <Route
            path="/kiosk/assembly/procedure-documents/:documentId/edit"
            element={lazyRouteElement(<KioskAssemblyProcedureDocumentEditorPage />)}
          />
          <Route
            path="/kiosk/assembly/procedure-order-settings"
            element={<AssemblyProcedureOrderRedirect />}
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
            path="/kiosk/part-measurement/self-inspection/work-instructions/edit"
            element={lazyRouteElement(<KioskWorkInstructionEditorPage />)}
          />
          <Route
            path="/kiosk/part-measurement/self-inspection/record-approvals"
            element={<KioskSelfInspectionRecordApprovalPage />}
          />
          <Route
            path="/kiosk/part-measurement/self-inspection/reduction"
            element={<KioskSelfInspectionReductionPage />}
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
          <Route path="/kiosk/machine-signal" element={<KioskMachineSignalPage />} />
          {isDevelopment ? (
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
                path="/dev/kiosk-assembly-home"
                element={lazyRouteElement(<KioskAssemblyHomePreviewPage />)}
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
      {isDevelopment ? (
        <>
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
            element={<KioskPrintWebUpdate>{lazyRouteElement(<KioskInspectionDrawingPrintPage />)}</KioskPrintWebUpdate>}
          />
          <Route
            path="/kiosk/part-measurement/inspection/paper-reports/:reportId/print"
            element={<KioskPrintWebUpdate>{lazyRouteElement(<KioskInspectionDrawingPrintPage />)}</KioskPrintWebUpdate>}
          />
        </>
      ) : null}
      <Route
        path="/preview"
        element={<AdminLayout />}
      >
        <Route path="import" element={lazyRouteElement(<CsvImportPage />)} />
      </Route>
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={lazyRouteElement(<DashboardPage />)} />
        <Route path="tools">
          <Route path="raspi-inventory" element={lazyRouteElement(<RaspiInventoryPage />)} />
          <Route path="employees" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
          <Route path="dgx-resource" element={lazyRouteElement(<DgxResourceAdminPage />)} />
          <Route path="items" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
          <Route path="unified" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
          <Route path="rigging-gears" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
          <Route path="inspection-items" element={lazyRouteElement(<InspectionItemsPage />)} />
          <Route path="instrument-tags" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
          <Route path="inspection-records" element={lazyRouteElement(<InspectionRecordsPage />)} />
          <Route path="measuring-instruments" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
          <Route path="torque-wrenches" element={lazyRouteElement(<TorqueWrenchesPage />)} />
          <Route path="assembly-torque-override" element={lazyRouteElement(<AssemblyTorqueOverridePage />)} />
          <Route path="measuring-instrument-genres" element={lazyRouteElement(<MeasuringInstrumentGenresPage />)} />
          <Route path="part-measurement-templates" element={lazyRouteElement(<PartMeasurementTemplatesPage />)} />
          <Route path="machines" element={lazyRouteElement(<MachinesPage />)} />
          <Route path="machines-uninspected" element={lazyRouteElement(<MachinesUninspectedPage />)} />
          <Route path="history" element={lazyRouteElement(<HistoryPage />)} />
        </Route>
        <Route path="clients" element={lazyRouteElement(<ClientsPage />)} />
        <Route path="kiosk-settings" element={lazyRouteElement(<KioskSettingsPage />)} />
        <Route path="security" element={lazyRouteElement(<SecurityPage />)} />
        <Route path="import" element={lazyRouteElement(<CsvImportPage />)} />
        <Route path="backup">
          <Route path="targets" element={lazyRouteElement(<BackupTargetsPage />)} />
          <Route path="config-history" element={lazyRouteElement(<BackupConfigHistoryPage />)} />
          <Route path="history" element={lazyRouteElement(<BackupHistoryPage />)} />
          <Route path="restore" element={lazyRouteElement(<BackupRestorePage />)} />
        </Route>
        <Route path="imports">
          <Route path="schedule" element={<Navigate to="/admin/import" replace />} />
        </Route>
        {/* 旧 2 ページ（可視化・CSV ダッシュボード）はデータボードへ転送する */}
        <Route path="data-boards" element={lazyRouteElement(<DataBoardsPage />)} />
        <Route path="csv-dashboards" element={<Navigate to="/admin/data-boards?type=table" replace />} />
        <Route path="production-schedule-settings" element={lazyRouteElement(<ProductionScheduleSettingsPage />)} />
        <Route
          path="part-measurement/self-inspection-reviews"
          element={lazyRouteElement(<SelfInspectionOutOfToleranceReviewsPage />)}
        />
        <Route path="visualization-dashboards" element={<Navigate to="/admin/data-boards?type=graph" replace />} />
        <Route path="pallet-machine-illustrations" element={lazyRouteElement(<PalletMachineIllustrationsPage />)} />
        <Route path="machine-signal" element={lazyRouteElement(<MachineSignalAdminPage />)} />
        <Route path="gmail">
          <Route path="config" element={lazyRouteElement(<GmailConfigPage />)} />
        </Route>
        <Route path="reports">
          <Route path="loan-report" element={lazyRouteElement(<LoanReportPage />)} />
        </Route>
        <Route path="knowledge-position-ranks" element={lazyRouteElement(<MovedToKioskTagDeskPage positionRanks />)} />
        <Route path="local-llm" element={lazyRouteElement(<LocalLlmAdminPage />)} />
        <Route path="dgx-resource" element={<Navigate to="/admin/tools/dgx-resource" replace />} />
        <Route path="placement-photos" element={lazyRouteElement(<PlacementPhotosPage />)} />
        <Route path="watch-camera" element={lazyRouteElement(<WatchCameraPage />)} />
        <Route path="photo-loan-label-reviews" element={lazyRouteElement(<PhotoLoanLabelReviewsPage />)} />
        <Route path="photo-gallery-seed" element={lazyRouteElement(<PhotoGallerySeedPage />)} />
        <Route path="kiosk-documents" element={lazyRouteElement(<KioskDocumentsAdminPage />)} />
        <Route path="signage">
          <Route index element={lazyRouteElement(<SignageHubPage />)} />
          {/* 旧 4 ページの URL は 1 画面ハブへ転送する */}
          <Route path="schedules" element={<Navigate to="/admin/signage" replace />} />
          <Route path="preview" element={<Navigate to="/admin/signage" replace />} />
          <Route path="pdfs" element={<Navigate to="/admin/signage?panel=pdf-upload" replace />} />
          <Route path="emergency" element={<Navigate to="/admin/signage?panel=emergency" replace />} />
        </Route>
        {/* 後方互換性のため、既存パスも維持 */}
        <Route path="employees" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
        <Route path="items" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
        <Route path="inspection-items" element={lazyRouteElement(<InspectionItemsPage />)} />
        <Route path="instrument-tags" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
        <Route path="inspection-records" element={lazyRouteElement(<InspectionRecordsPage />)} />
        <Route path="measuring-instruments" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
        <Route path="measuring-instrument-genres" element={lazyRouteElement(<MeasuringInstrumentGenresPage />)} />
        <Route path="machines" element={lazyRouteElement(<MachinesPage />)} />
        <Route path="machines-uninspected" element={lazyRouteElement(<MachinesUninspectedPage />)} />
        <Route path="rigging-gears" element={lazyRouteElement(<MovedToKioskTagDeskPage />)} />
        <Route path="history" element={lazyRouteElement(<HistoryPage />)} />
      </Route>
      <Route path="*" element={<Navigate to="/kiosk" replace />} />
      </Routes>
      <HermesFloatingChat />
      <KioskScreenWatchHost />
    </HermesPageContextProvider>
  );
}

export default App;

// Print routes intentionally live outside KioskLayout, but share its update policy.
function KioskPrintWebUpdate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: deployStatus } = useDeployStatus();
  useKioskSeamlessWebUpdate(location.pathname, deployStatus === undefined || deployStatus.isMaintenance);
  return <>{children}</>;
}

function AssemblyProcedureOrderRedirect() {
  const location = useLocation();
  const { machineName } = parseAssemblyProcedureOrderSettingsSearch(location.search);
  return (
    <Navigate
      to={kioskAssemblyLibraryPath({ focus: 'templates', modelCode: machineName })}
      replace
    />
  );
}
