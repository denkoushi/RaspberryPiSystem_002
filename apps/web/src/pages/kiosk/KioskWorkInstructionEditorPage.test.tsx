import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    rows: [],
    reviewCount: 0,
    unassignedMemoCount: 0,
    nextReview: vi.fn(),
    addDefaultOverlay: vi.fn(),
    duplicateSelectedOverlay: vi.fn(),
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
  let wideEditor = true;
  let widthListeners: Set<() => void>;

  beforeEach(() => {
    wideEditor = true;
    widthListeners = new Set();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      media: query,
      get matches() { return wideEditor; },
      addEventListener: (_event: string, listener: () => void) => widthListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => widthListeners.delete(listener)
    })));
    mocks.nfcEvent = null;
    mocks.controller = makeController();
  });

  it('keeps the editor behind the employee NFC gate and authenticates the scanned UID', async () => {
    const controller = makeController();
    mocks.controller = controller;
    mocks.nfcEvent = { uid: 'employee-tag-1', timestamp: 1 };

    renderPage();

    expect(screen.getByTestId('work-instruction-editor-nfc-gate')).toBeInTheDocument();
    expect(screen.getByText('社員タグ')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: '履歴', exact: true }));

    expect(screen.getByTestId('work-instruction-editor-audit-list')).toBeInTheDocument();
    const auditList = screen.getByTestId('work-instruction-editor-audit-list');
    expect(within(auditList).getByText('下書きを保存')).toBeInTheDocument();
    expect(within(auditList).getByText('山田 太郎')).toBeInTheDocument();
    expect(within(auditList).getByText('変更 1 件')).toBeInTheDocument();
    expect(within(auditList).getByText('端末: Kiosk Pi')).toBeInTheDocument();
    expect(within(auditList).queryByText(/overlay-1|詳細差分/)).not.toBeInTheDocument();
  });

  it('keeps the comparison target in an explicit full-height flex frame', () => {
    mocks.controller = makeController({ accessGranted: true, hasUpdate: true });

    renderPage();

    expect(screen.getByTestId('work-instruction-editor-comparison-layout')).toHaveClass('min-h-0');
    expect(screen.getByTestId('work-instruction-editor-target-pane')).toHaveClass('flex', 'h-full', 'min-h-0');
  });
  it('overlays manually opened panels without reserving canvas space on narrow screens', () => {
    wideEditor = false;
    mocks.controller = makeController({ accessGranted: true, hasUpdate: true });
    renderPage();

    const target = screen.getByTestId('work-instruction-editor-target-pane');
    expect(screen.queryByTestId('work-instruction-editor-comparison-pane')).not.toBeInTheDocument();
    expect(target).toHaveStyle({ marginRight: '0px' });
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: '比較', exact: true }));
    expect(screen.getByTestId('work-instruction-editor-comparison-pane')).toHaveStyle({ right: '16px' });
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: 'メモ', exact: true }));
    expect(screen.getByRole('complementary', { name: '作業メモ' })).toBeInTheDocument();
    expect(target).toHaveStyle({ marginRight: '0px' });

    act(() => {
      wideEditor = true;
      widthListeners.forEach((listener) => listener());
    });
    expect(target).toHaveStyle({ marginRight: '752px' });
    expect(screen.getByTestId('work-instruction-editor-comparison-pane')).toHaveStyle({ right: '372px' });
  });

  it('updates automatic comparison visibility when crossing the desktop breakpoint', () => {
    mocks.controller = makeController({ accessGranted: true, hasUpdate: true });
    const { unmount } = renderPage();
    const target = screen.getByTestId('work-instruction-editor-target-pane');
    expect(target).toHaveStyle({ marginRight: '396px' });
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1280px)');
    act(() => {
      wideEditor = false;
      widthListeners.forEach((listener) => listener());
    });
    expect(screen.queryByTestId('work-instruction-editor-comparison-pane')).not.toBeInTheDocument();
    expect(target).toHaveStyle({ marginRight: '0px' });
    act(() => {
      wideEditor = true;
      widthListeners.forEach((listener) => listener());
    });
    expect(screen.getByTestId('work-instruction-editor-comparison-pane')).toBeInTheDocument();
    unmount();
    expect(widthListeners.size).toBe(0);
  });

  it('opens comparison initially only when an update exists and closes it', () => {
    mocks.controller = makeController({ accessGranted: true });
    renderPage();
    expect(screen.queryByTestId('work-instruction-editor-comparison-pane')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: '比較', exact: true }));
    expect(screen.getByTestId('work-instruction-editor-comparison-pane')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '原本の比較を閉じる' }));
    expect(screen.queryByTestId('work-instruction-editor-comparison-pane')).not.toBeInTheDocument();
  });

  it('adds annotations directly from the rail and closes the more menu on Escape and outside press', () => {
    const controller = makeController({ accessGranted: true, activeStep: {}, activeRevision: {} });
    mocks.controller = controller;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '文字' }));
    expect(controller.addDefaultOverlay).toHaveBeenCalledWith('TEXT');
    fireEvent.click(screen.getByRole('button', { name: '図形', exact: true }));
    expect(controller.addDefaultOverlay).toHaveBeenCalledWith('SHAPE');
    const more = screen.getByRole('button', { name: 'その他' });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveFocus();
    fireEvent.click(more);
    fireEvent.pointerDown(screen.getByTestId('work-instruction-editor-target-pane'));
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses ordinary messages after four seconds and retains conflict actions', () => {
    vi.useFakeTimers();
    try {
      mocks.controller = makeController({ accessGranted: true, message: '保存しました' });
      const view = renderPage();
      expect(screen.getByTestId('work-instruction-editor-toolbar-message')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(4000));
      expect(screen.queryByTestId('work-instruction-editor-toolbar-message')).not.toBeInTheDocument();
      mocks.controller = makeController({ accessGranted: true, message: '別の社員が更新しました', conflict: { revisionId: 'draft', currentEditVersion: 2 } });
      view.rerender(<MemoryRouter><KioskWorkInstructionEditorPage /></MemoryRouter>);
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByTestId('work-instruction-editor-toolbar-message')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '保持内容を再保存' }));
      expect(mocks.controller.retryConflictSave).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

});
