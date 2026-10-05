import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorProvider } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorScreen } from './AssemblyProcedureDocumentEditorScreen';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const approvalMocks = vi.hoisted(() => ({ read: null as { uid: string } | null, resolve: vi.fn() }));
vi.mock('../../../api/client', () => ({ resolveProcedureManualApprover: approvalMocks.resolve }));
vi.mock('../../kiosk/inventory/setup/useArmedNfcRead', () => ({ useArmedNfcRead: (armed: boolean) => armed ? approvalMocks.read : null }));

vi.mock('./AssemblyProcedureDocumentEditorCanvas', () => ({
  AssemblyProcedureDocumentEditorCanvas: () => <div aria-label="手順書キャンバス" data-testid="editor-canvas" />
}));
vi.mock('../KioskDocumentPageImage', () => ({ KioskDocumentPageImage: () => <span /> }));
vi.mock('../procedure-manuals/ProcedureMaterialShelfDialog', () => ({
  ProcedureMaterialShelfDialog: ({ onSelect }: { onSelect: (material: { id: string }) => Promise<void> }) => <div role="dialog" aria-label="素材"><button onClick={() => void onSelect({ id: 'material' })}>配置</button></div>
}));
vi.mock('./AssemblyProcedureDocumentEditorInspector', () => ({
  AssemblyProcedureDocumentEditorInspector: ({
    element,
    onRefetchTextCandidates
  }: {
    element: AssemblyProcedureOverlayElement | null;
    onRefetchTextCandidates: () => void;
  }) => (
    <aside aria-label="オーバーレイ編集" data-testid="editor-inspector">
      {element?.kind === 'TEXT' ? (
        <button type="button" onClick={onRefetchTextCandidates}>この範囲で候補を再取得</button>
      ) : null}
    </aside>
  )
}));

const editorDocument = {
  id: 'document-1',
  name: '組立手順書',
  imageRelativePath: '/pages/1.png',
  status: 'draft' as const,
  publishedAt: null,
  isActive: false,
  isRevisionHead: true,
  editVersion: 2,
  pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [] }],
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

function makeController(
  overrides: Partial<AssemblyProcedureDocumentEditorController> = {}
): AssemblyProcedureDocumentEditorController {
  const selectedPage = editorDocument.pages[0]!;
  return {
    addBlankPage: vi.fn(async () => undefined),
    placeMaterial: vi.fn(async () => undefined),
    document: editorDocument,
    pages: editorDocument.pages,
    loading: false,
    accessGranted: true,
    busy: false,
    message: null,
    conflict: false,
    conflictEditVersion: null,
    reloadConflict: vi.fn(async () => undefined),
    retryConflictSave: vi.fn(async () => undefined),
    passwordInput: '1234',
    setPasswordInput: vi.fn(),
    verifyEditorPassword: vi.fn(async () => undefined),
    selectedPageIndex: 0,
    setSelectedPageIndex: vi.fn(),
    selectedPage,
    selectedPageElements: [],
    selectedOverlayId: null,
    setSelectedOverlayId: vi.fn(),
    selectedElement: null,
    elements: [],
    selectionMode: false,
    setSelectionMode: vi.fn(),
    pendingRange: null,
    cancelPendingRange: vi.fn(),
    createOverlay: vi.fn(async () => undefined),
    handleRangeSelected: vi.fn(),
    updateElement: vi.fn(),
    deleteSelectedOverlay: vi.fn(),
    save: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    navigateBack: vi.fn(),
    isDirty: false,
    readOnly: false,
    editLease: null,
    editLeaseMine: true,
    editLeasePending: false,
    editLeaseUnavailable: false,
    takeoverEditLease: vi.fn(async () => undefined),
    retryEditLease: vi.fn(async () => undefined),
    canSave: false,
    canPublish: true,
    canDiscard: false,
    textCandidates: [],
    chooseTextCandidate: vi.fn(),
    cancelTextCandidates: vi.fn(),
    refetchTextCandidates: vi.fn(async () => undefined),
    uploadImage: vi.fn(async () => undefined),
    bringForward: vi.fn(),
    sendBackward: vi.fn(),
    nudgeElement: vi.fn(),
    updateElementBBox: vi.fn(),
    confirmNavigation: vi.fn(() => true),
    recoveryPending: null,
    restoreRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    ...overrides
  };
}

function renderScreen(controller: AssemblyProcedureDocumentEditorController) {
  return render(
    <AssemblyProcedureDocumentEditorProvider value={controller}>
      <AssemblyProcedureDocumentEditorScreen />
    </AssemblyProcedureDocumentEditorProvider>
  );
}

describe('AssemblyProcedureDocumentEditorScreen', () => {
  beforeEach(() => { approvalMocks.read = null; approvalMocks.resolve.mockReset(); });
  it('runs blank-page addition from the page list', () => {
    const addBlankPage = vi.fn(async () => undefined);
    renderScreen(makeController({ addBlankPage }));
    fireEvent.click(screen.getByRole('button', { name: '白紙ページを追加' }));
    expect(addBlankPage).toHaveBeenCalledOnce();
  });
  it('opens the material selector and places the selected material', async () => {
    const placeMaterial = vi.fn(async () => undefined);
    renderScreen(makeController({ placeMaterial }));
    fireEvent.click(screen.getByRole('button', { name: '素材から配置' }));
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    await waitFor(() => expect(placeMaterial).toHaveBeenCalledWith({ id: 'material' }));
  });

  it('keeps the canvas row usable below xl and prevents the editor shell from overflowing', () => {
    window.innerWidth = 900;
    renderScreen(makeController());
    const layout = screen.getByTestId('assembly-document-editor-layout');
    expect(layout).toHaveClass(
      'grid-rows-[8rem_minmax(16rem,1fr)_minmax(10rem,14rem)]',
      'overflow-hidden'
    );
    expect(screen.getByTestId('editor-canvas')).toBeVisible();
    expect(screen.getByRole('region', { name: '手順書キャンバス' })).toBeInTheDocument();
  });

  it('routes an unsaved back action through the navigation guard', () => {
    const navigateBack = vi.fn();
    const confirmNavigation = vi.fn(() => true);
    renderScreen(makeController({ isDirty: true, navigateBack, confirmNavigation }));
    fireEvent.click(screen.getByRole('button', { name: '一覧へ' }));
    expect(navigateBack).toHaveBeenCalledTimes(1);
  });

  it('requires explicit confirmation before publishing', () => {
    const publish = vi.fn(async () => undefined);
    renderScreen(makeController({ publish }));
    fireEvent.click(screen.getByRole('button', { name: '公開' }));
    expect(screen.getByRole('dialog', { name: '手順書を公開' })).toBeInTheDocument();
    expect(screen.getByText(/公開すると/)).toBeInTheDocument();
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '社員タグで承認して公開' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'パスワードで公開(締付テンプレート向け)' }));
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('reads an employee tag, confirms name and position, then publishes with an optional comment', async () => {
    approvalMocks.resolve.mockResolvedValue({ displayName: '承認太郎', positionName: '班長', rank: 'leader' });
    const publish = vi.fn(async () => true);
    const controller = makeController({ publish });
    const view = renderScreen(controller);
    fireEvent.click(screen.getByRole('button', { name: '公開' }));
    expect(screen.getByRole('button', { name: '承認して公開する' })).toBeDisabled();
    approvalMocks.read = { uid: 'TAG' };
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen /></AssemblyProcedureDocumentEditorProvider>);
    expect(await screen.findByText('承認者: 承認太郎(班長)')).toBeInTheDocument();
    expect(approvalMocks.resolve).toHaveBeenCalledExactlyOnceWith('TAG');
    expect(publish).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('コメント(任意)'), { target: { value: ' 確認済み ' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して公開する' }));
    await waitFor(() => expect(publish).toHaveBeenCalledExactlyOnceWith({ reviewerTagUid: 'TAG', comment: '確認済み' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '手順書を公開' })).not.toBeInTheDocument());
  });

  it('shows the last approver in the editor status row', () => {
    renderScreen(makeController({ document: { ...editorDocument, lastApproval: { employeeName: '承認太郎', positionName: '班長', approvedAt: '2026-10-05T09:00:00Z' } } }));
    expect(screen.getByText(/承認: 承認太郎\(班長\)/)).toBeInTheDocument();
  });

  it('disables editing actions in read-only mode while retaining accessible labels', () => {
    renderScreen(makeController({ readOnly: true, canPublish: false }));
    expect(screen.getByRole('button', { name: '範囲を追加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '公開' })).toBeDisabled();
    expect(screen.getByRole('region', { name: '手順書キャンバス' })).toBeInTheDocument();
  });

  it('routes explicit OCR candidate re-fetch from the selected text inspector', () => {
    const refetchTextCandidates = vi.fn(async () => undefined);
    renderScreen(makeController({
      selectedElement: {
        id: 'text-1',
        pageIndex: 0,
        bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 },
        zIndex: 0,
        kind: 'TEXT',
        text: '既存文章'
      },
      refetchTextCandidates
    }));

    fireEvent.click(screen.getByRole('button', { name: 'この範囲で候補を再取得' }));
    expect(refetchTextCandidates).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('shows a warning and keeps editing enabled when the lease is unavailable (mine=%s)', (mine) => {
    const retryEditLease = vi.fn();
    renderScreen(makeController({
      editLeaseMine: mine,
      editLeaseUnavailable: true,
      editLease: mine ? { holderLabel: '自分の端末', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:00:00Z' } : null,
      canSave: true,
      retryEditLease
    }));
    expect(screen.getByRole('status')).toHaveTextContent('編集の予約を取れていません(他端末と同時編集に注意)');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '白紙ページを追加' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '引き継ぐ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '予約を再取得' }));
    expect(retryEditLease).toHaveBeenCalledOnce();
  });

  it('shows the holder in read-only mode and requires confirmation before takeover', async () => {
    const takeoverEditLease = vi.fn(async () => undefined);
    renderScreen(makeController({
      readOnly: true,
      editLeaseMine: false,
      editLease: { holderLabel: '組立端末 2', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:01:00Z' },
      takeoverEditLease
    }));
    expect(screen.getByText(/組立端末 2が編集中/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '白紙ページを追加' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '引き継ぐ' }));
    expect(screen.getByRole('dialog', { name: '編集を引き継ぐ' })).toBeInTheDocument();
    expect(takeoverEditLease).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '引き継ぐ' })[1]!);
    await waitFor(() => expect(takeoverEditLease).toHaveBeenCalledOnce());
  });
});
