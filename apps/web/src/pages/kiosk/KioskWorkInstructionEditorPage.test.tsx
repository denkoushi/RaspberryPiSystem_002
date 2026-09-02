import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  controller: null as Record<string, unknown> | null,
  nfcEvent: null as { uid: string; timestamp: number } | null
}));

vi.mock('../../features/work-instructions/useWorkInstructionEditorController', () => ({
  useWorkInstructionEditorController: () => mocks.controller
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: (enabled: boolean) => enabled ? mocks.nfcEvent : null
}));

vi.mock('../../features/work-instructions/WorkInstructionEditorCanvas', () => ({
  WorkInstructionEditorCanvas: () => null
}));
vi.mock('../../features/work-instructions/WorkInstructionEditorInspector', () => ({
  WorkInstructionEditorInspector: () => null
}));
vi.mock('../../features/work-instructions/WorkInstructionEditorNavigation', () => ({
  WorkInstructionEditorRowsPane: () => null,
  WorkInstructionEditorStepsPane: () => null
}));
vi.mock('../../features/work-instructions/WorkInstructionEditorToolbarStatus', () => ({
  WorkInstructionEditorToolbarStatus: () => null
}));
vi.mock('../../features/work-instructions/WorkInstructionOverlayTypeDialog', () => ({
  WorkInstructionOverlayTypeDialog: () => null
}));
vi.mock('../../features/work-instructions/WorkInstructionTextCandidateDialog', () => ({
  WorkInstructionTextCandidateDialog: () => null
}));
vi.mock('../../features/work-instructions/WorkInstructionVersionComparison', () => ({
  WorkInstructionVersionComparison: () => null
}));
vi.mock('../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: () => null
}));

import { KioskWorkInstructionEditorPage } from './KioskWorkInstructionEditorPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/work-instruction-editor?partNumber=PART-1&shootingTarget=%E5%8A%A0%E5%B7%A5']}>
      <KioskWorkInstructionEditorPage />
    </MemoryRouter>
  );
}

function makeController(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    group: { rows: [], history: [] },
    accessGranted: false,
    editorAuthentication: null,
    auditItems: [],
    busy: false,
    authenticate: vi.fn(),
    message: null,
    hasUpdate: false,
    activeRow: null,
    activeRevision: null,
    activeStep: null,
    activeSteps: [],
    activeElements: [],
    activeStepElements: [],
    activeAssets: {},
    activeMemo: '',
    activeMemoOverride: null,
    activeMemoOverrides: {},
    activeMemoOverridesArray: [],
    memoOverridesByRevision: {},
    selectedRowId: null,
    selectedStepKey: null,
    selectedOverlayId: null,
    selectedElement: null,
    selectRow: vi.fn(),
    selectStep: vi.fn(),
    updateMemo: vi.fn(),
    resetMemo: vi.fn(),
    keepMemo: vi.fn(),
    assignMemoAndKeep: vi.fn(),
    useSourceMemo: vi.fn(),
    setSelectedOverlayId: vi.fn(),
    selectionMode: false,
    setSelectionMode: vi.fn(),
    pendingRange: null,
    setPendingRange: vi.fn(),
    createOverlay: vi.fn(),
    textCandidates: [],
    chooseTextCandidate: vi.fn(),
    cancelTextCandidates: vi.fn(),
    refetchTextCandidates: vi.fn(),
    uploadImage: vi.fn(),
    updateElement: vi.fn(),
    updateElementBBox: vi.fn(),
    assignOverlayStep: vi.fn(),
    bringForward: vi.fn(),
    sendBackward: vi.fn(),
    nudgeElement: vi.fn(),
    deleteSelectedOverlay: vi.fn(),
    save: vi.fn(),
    retryConflictSave: vi.fn(),
    reloadConflict: vi.fn(),
    publish: vi.fn(),
    discard: vi.fn(),
    conflict: null,
    isDirty: false,
    canSave: false,
    canPublish: false,
    canDiscard: false,
    navigateBack: vi.fn(),
    confirmNavigation: vi.fn(),
    recoveryPending: null,
    restoreRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    deleteSourceImage: vi.fn(),
    ...overrides
  };
}

describe('KioskWorkInstructionEditorPage NFC editor gate and history', () => {
  beforeEach(() => {
    mocks.nfcEvent = null;
    mocks.controller = makeController();
  });

  it('keeps the editor behind the employee NFC gate and authenticates the scanned UID', async () => {
    const controller = makeController();
    mocks.controller = controller;
    mocks.nfcEvent = { uid: 'employee-tag-1', timestamp: 1 };

    renderPage();

    expect(screen.getByTestId('work-instruction-editor-nfc-gate')).toBeInTheDocument();
    expect(screen.getByText('社員NFCタグを確認中…')).toBeInTheDocument();
    await waitFor(() => expect(controller.authenticate).toHaveBeenCalledWith('employee-tag-1'));
  });

  it('shows audit snapshots and action details in the existing history pane', () => {
    mocks.controller = makeController({
      accessGranted: true,
      auditItems: [{
        id: 'audit-1',
        action: 'SAVED',
        employeeIdSnapshot: 'employee-1',
        employeeCodeSnapshot: '0001',
        employeeNameSnapshot: '山田 太郎',
        clientDeviceIdSnapshot: 'device-1',
        clientDeviceNameSnapshot: 'Kiosk Pi',
        changeSet: { overlays: { added: ['overlay-1'] } },
        createdAt: '2026-09-02T01:02:03.000Z'
      }]
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '履歴を表示' }));

    expect(screen.getByTestId('work-instruction-editor-audit-list')).toBeInTheDocument();
    const auditList = screen.getByTestId('work-instruction-editor-audit-list');
    expect(within(auditList).getByText('保存')).toBeInTheDocument();
    expect(within(auditList).getByText('山田 太郎')).toBeInTheDocument();
    expect(within(auditList).getByText('社員コード 0001')).toBeInTheDocument();
    expect(within(auditList).getByText('端末: Kiosk Pi')).toBeInTheDocument();
    expect(within(auditList).getByText('詳細差分')).toBeInTheDocument();
  });

  it('keeps the comparison target in an explicit full-height flex frame', () => {
    mocks.controller = makeController({ accessGranted: true });

    renderPage();

    expect(screen.getByTestId('work-instruction-editor-comparison-layout')).toHaveClass('flex-1', 'min-h-0');
    expect(screen.getByTestId('work-instruction-editor-target-pane')).toHaveClass('flex', 'h-full', 'min-h-0');
  });
});
