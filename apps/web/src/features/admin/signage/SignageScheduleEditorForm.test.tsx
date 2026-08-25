import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SignageScheduleEditorForm } from './SignageScheduleEditorForm';

import type { SignageScheduleEditorController } from './useSignageScheduleEditor';

vi.mock('./SelfInspectionMachineBoardFields', () => ({
  SelfInspectionMachineBoardFields: (props: Record<string, unknown>) => (
    <div
      data-testid="self-inspection-fields"
      data-target-mode={String(props.targetMode)}
      data-legacy-notice={String(props.legacyAutoMigrationNotice)}
    />
  ),
}));

function createEditor(): SignageScheduleEditorController {
  const noop = vi.fn();
  const query = { data: [], isPending: false, isError: false };
  return {
    isCreating: true,
    editingId: null,
    formData: {
      name: '自主検査テスト',
      contentType: 'TOOLS',
      dayOfWeek: [1],
      startTime: '09:00',
      endTime: '18:00',
      priority: 1,
      enabled: true,
      targetClientKeys: [],
    },
    setFormData: noop,
    useNewLayout: true,
    setUseNewLayout: noop,
    layoutType: 'FULL',
    setLayoutType: noop,
    fullSlotKind: 'self_inspection_machine_board',
    setFullSlotKind: noop,
    resetFullSlotSpecificFields: noop,
    fullPdfId: null,
    setFullPdfId: noop,
    fullCsvDashboardId: null,
    setFullCsvDashboardId: noop,
    fullVisualizationDashboardId: null,
    setFullVisualizationDashboardId: noop,
    fullKioskDeviceScopeKey: '',
    setFullKioskDeviceScopeKey: noop,
    fullKioskSlideIntervalStr: '',
    setFullKioskSlideIntervalStr: noop,
    fullKioskSeibanPerPageStr: '',
    setFullKioskSeibanPerPageStr: noop,
    fullLeaderOrderDeviceScopeKey: '',
    setFullLeaderOrderDeviceScopeKey: noop,
    fullLeaderOrderResourceCdsText: '',
    setFullLeaderOrderResourceCdsText: noop,
    fullLeaderOrderSlideIntervalStr: '',
    setFullLeaderOrderSlideIntervalStr: noop,
    fullLeaderOrderCardsPerPageStr: '',
    setFullLeaderOrderCardsPerPageStr: noop,
    fullPartsShelfMaxItemsStr: '',
    setFullPartsShelfMaxItemsStr: noop,
    fullSelfInspectionTargetMode: 'kiosk_active_sessions',
    setFullSelfInspectionTargetMode: noop,
    fullSelfInspectionMachineName: '',
    setFullSelfInspectionMachineName: noop,
    fullSelfInspectionDeviceScopeKey: '',
    setFullSelfInspectionDeviceScopeKey: noop,
    fullSelfInspectionSlideIntervalStr: '',
    setFullSelfInspectionSlideIntervalStr: noop,
    fullSelfInspectionPartsPerPageStr: '',
    setFullSelfInspectionPartsPerPageStr: noop,
    fullSelfInspectionLegacyAutoMigrationNotice: true,
    setFullSelfInspectionLegacyAutoMigrationNotice: noop,
    fullSelfInspectionDetailTopNStr: '',
    setFullSelfInspectionDetailTopNStr: noop,
    leftSlotKind: 'loans',
    setLeftSlotKind: noop,
    leftPdfId: null,
    setLeftPdfId: noop,
    leftCsvDashboardId: null,
    setLeftCsvDashboardId: noop,
    leftVisualizationDashboardId: null,
    setLeftVisualizationDashboardId: noop,
    rightSlotKind: 'pdf',
    setRightSlotKind: noop,
    rightPdfId: null,
    setRightPdfId: noop,
    rightCsvDashboardId: null,
    setRightCsvDashboardId: noop,
    rightVisualizationDashboardId: null,
    setRightVisualizationDashboardId: noop,
    pdfsQuery: query,
    csvDashboardsQuery: query,
    visualizationDashboardsQuery: query,
    clientsForSignageQuery: query,
    create: { isPending: false },
    update: { isPending: false },
    toggleDayOfWeek: noop,
    handleSave: noop,
    handleCancel: noop,
  } as unknown as SignageScheduleEditorController;
}

describe('SignageScheduleEditorForm self-inspection wiring', () => {
  it('passes kiosk mode and the legacy migration notice to the extracted fields', () => {
    render(<SignageScheduleEditorForm editor={createEditor()} />);

    expect(screen.getByTestId('self-inspection-fields')).toHaveAttribute(
      'data-target-mode',
      'kiosk_active_sessions'
    );
    expect(screen.getByTestId('self-inspection-fields')).toHaveAttribute('data-legacy-notice', 'true');
  });
});
