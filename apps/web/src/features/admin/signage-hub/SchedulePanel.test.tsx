import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SchedulePanel } from './SchedulePanel';

import type { SignageScheduleEditorController } from '../signage/useSignageScheduleEditor';

vi.mock('../signage/SelfInspectionMachineBoardFields', () => ({
  SelfInspectionMachineBoardFields: (props: Record<string, unknown>) => (
    <div
      data-testid="self-inspection-fields"
      data-target-mode={String(props.targetMode)}
      data-legacy-notice={String(props.legacyAutoMigrationNotice)}
    />
  ),
}));
vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('../../../api/hooks', () => ({
  useSignageScheduleMutations: () => ({ remove: { mutateAsync: vi.fn() } }),
}));

function createEditor(overrides: Record<string, unknown> = {}): SignageScheduleEditorController {
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
    create: { isPending: false, isError: false },
    update: { isPending: false, isError: false },
    toggleDayOfWeek: noop,
    handleSave: noop,
    handleCancel: noop,
    preservedCanvasLayoutConfig: null,
    fullWebCaptureId: null,
    setFullWebCaptureId: noop,
    webCapturesQuery: query,
    ...overrides,
  } as unknown as SignageScheduleEditorController;
}

describe('SchedulePanel', () => {
  it('passes kiosk mode and the legacy migration notice to the self-inspection fields', () => {
    render(<SchedulePanel editor={createEditor()} />);

    expect(screen.getByTestId('self-inspection-fields')).toHaveAttribute('data-target-mode', 'kiosk_active_sessions');
    expect(screen.getByTestId('self-inspection-fields')).toHaveAttribute('data-legacy-notice', 'true');
  });

  it('toggles days from the day buttons and shows which are on', () => {
    const toggleDayOfWeek = vi.fn();
    render(<SchedulePanel editor={createEditor({ toggleDayOfWeek })} />);

    expect(screen.getByRole('button', { name: '月曜' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '火曜' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '火曜' }));
    expect(toggleDayOfWeek).toHaveBeenCalledWith(2);
  });

  it('blocks saving and explains why when no day is selected', () => {
    const handleSave = vi.fn();
    const editor = createEditor({ handleSave, fullSlotKind: 'loans' });
    (editor.formData as { dayOfWeek: number[] }).dayOfWeek = [];
    render(<SchedulePanel editor={editor} />);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('曜日を 1 つ以上選んでください');
    expect(handleSave).not.toHaveBeenCalled();
  });

  it('saves a valid schedule', () => {
    const handleSave = vi.fn();
    render(<SchedulePanel editor={createEditor({ handleSave, fullSlotKind: 'loans' })} />);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(handleSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches a legacy schedule to the new layout format, but leaves a Chat-made layout untouched', () => {
    const setUseNewLayout = vi.fn();
    const { unmount } = render(<SchedulePanel editor={createEditor({ useNewLayout: false, setUseNewLayout, fullSlotKind: 'loans' })} />);
    expect(setUseNewLayout).toHaveBeenCalledWith(true);
    unmount();

    const setForChat = vi.fn();
    render(
      <SchedulePanel
        editor={createEditor({
          useNewLayout: false,
          setUseNewLayout: setForChat,
          preservedCanvasLayoutConfig: { layout: 'CANVAS', width: 1920, height: 1080, backgroundColor: '#000', elements: [] },
        })}
      />,
    );
    expect(setForChat).not.toHaveBeenCalled();
    expect(screen.getByText(/Chat で作った画面です/)).toBeInTheDocument();
    expect(screen.queryByText('画面の分け方')).not.toBeInTheDocument();
  });
});
