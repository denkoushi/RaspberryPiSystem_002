import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorProvider } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorScreen } from './AssemblyProcedureDocumentEditorScreen';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const approvalMocks = vi.hoisted(() => ({ read: null as { uid: string } | null, resolve: vi.fn(), materials: vi.fn(async () => []), videos: vi.fn(async () => []), pageVideos: vi.fn(async () => []), saveVideos: vi.fn() }));
vi.mock('../../../api/client', () => ({ resolveProcedureManualApprover: approvalMocks.resolve, listProcedureMaterials: approvalMocks.materials, listProcedureVideos: approvalMocks.videos, getProcedurePageVideos: approvalMocks.pageVideos, replaceProcedurePageVideos: approvalMocks.saveVideos }));
vi.mock('../../kiosk/inventory/setup/useArmedNfcRead', () => ({ useArmedNfcRead: (armed: boolean) => armed ? approvalMocks.read : null }));

vi.mock('./AssemblyProcedureDocumentEditorCanvas', () => ({
  AssemblyProcedureDocumentEditorCanvas: () => <div aria-label="手順書キャンバス" data-testid="editor-canvas" />
}));
vi.mock('../KioskDocumentPageImage', () => ({ KioskDocumentPageImage: () => <span /> }));
vi.mock('../procedure-manuals/ProcedureMaterialShelfDialog', () => ({
  ProcedureMaterialShelfDialog: ({ onSelect, onClose, mode, onCreatedDocument }: { onSelect: (material: { id: string; kind: 'PHOTO'; documentId?: string; placedAt?: string }) => Promise<void>; onClose: () => void; onCreatedDocument: (documentId: string) => void; mode: 'place' | 'replace' }) => <div role="dialog" aria-label="素材"><button onClick={() => void onSelect({ id: 'material', kind: 'PHOTO' })}>{mode === 'replace' ? 'この素材に差し替え' : '配置'}</button><button onClick={() => void onSelect({ id: 'placed-material', kind: 'PHOTO', documentId: 'old-document', placedAt: '2026-10-05T04:00:00Z' })}>配置済み素材を選択</button><button onClick={() => onCreatedDocument('created-document')}>要領書を作る</button><button onClick={onClose}>閉じる</button></div>
}));
vi.mock('./AssemblyProcedureDocumentEditorInspector', () => ({
  AssemblyProcedureDocumentEditorInspector: ({
    element,
    onRefetchTextCandidates,
    onReplaceImage,
    onBringToFront,
    onSendToBack,
    onClose
  }: {
    element: AssemblyProcedureOverlayElement | null;
    onRefetchTextCandidates: () => void;
    onReplaceImage: () => void;
    onBringToFront: (id: string) => void;
    onSendToBack: (id: string) => void;
    onClose: () => void;
  }) => (
    <aside aria-label="オーバーレイ編集" data-testid="editor-inspector">
      <button onClick={onClose} aria-label="属性を閉じる">✕</button>
      <button onClick={() => element && onBringToFront(element.id)}>最前面へ</button>
      <button onClick={() => element && onSendToBack(element.id)}>最背面へ</button>
      {element?.kind === 'TEXT' ? (
        <button type="button" onClick={onRefetchTextCandidates}>この範囲で候補を再取得</button>
      ) : null}
      {element?.kind === 'IMAGE' ? <button onClick={onReplaceImage}>素材から差し替え</button> : null}
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
    onEditLeaseError: vi.fn(() => false),
    beginOverlayDrag: vi.fn(),
    endOverlayDrag: vi.fn(),
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    addOverlay: vi.fn(),
    duplicateSelectedOverlay: vi.fn(),
    messageIsError: false,
    addBlankPage: vi.fn(async () => undefined),
    placeMaterial: vi.fn(async () => undefined),
    replaceSelectedImageMaterial: vi.fn(async () => undefined),
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
    deleteDocument: vi.fn(async () => undefined),
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
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    nudgeElement: vi.fn(),
    updateElementBBox: vi.fn(),
    confirmNavigation: vi.fn(() => true),
    recoveryPending: null,
    restoreRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    ...overrides
  };
}

function renderScreen(controller: AssemblyProcedureDocumentEditorController, onNavigateToDocument = vi.fn()) {
  return render(
    <AssemblyProcedureDocumentEditorProvider value={controller}>
      <AssemblyProcedureDocumentEditorScreen onNavigateToDocument={onNavigateToDocument} />
    </AssemblyProcedureDocumentEditorProvider>
  );
}

describe('AssemblyProcedureDocumentEditorScreen', () => {
  beforeEach(() => { approvalMocks.read = null; approvalMocks.resolve.mockReset(); });
  it('connects front and back inspector controls to the controller', () => {
    const element: AssemblyProcedureOverlayElement = {
      id: 'overlay', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, zIndex: 0,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 }
    };
    const controller = makeController({ selectedElement: element });
    renderScreen(controller);
    fireEvent.click(screen.getByRole('button', { name: '最前面へ' }));
    expect(controller.bringToFront).toHaveBeenCalledExactlyOnceWith(element.id);
    fireEvent.click(screen.getByRole('button', { name: '最背面へ' }));
    expect(controller.sendToBack).toHaveBeenCalledExactlyOnceWith(element.id);
  });
  it.each([['make', 1, null, '作る · 下書き 第1版', 'text-[#3ba776]'], ['fix', 3, 'root', '直す · 改版の下書き 第3版', 'text-[#f6b93b]'], ['fix', 1, null, '直す · 下書き 第1版', 'text-[#f6b93b]']] as const)('shows workshop context for %s', (mode, revisionNumber, supersedesDocumentId, label, color) => {
    const controller = makeController({ document: { ...editorDocument, revisionNumber, supersedesDocumentId } });
    render(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} context={{ modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立 › 組立', mode }} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.getByText('DFD1 › 組立 › 組立 › 組立手順書')).toBeInTheDocument();
    expect(screen.getByText(label)).toHaveClass(color);
    const actions = within(screen.getByRole('navigation', { name: 'エディタ操作' })).getAllByRole('button');
    expect(actions[0]).toHaveAttribute('aria-label', '保存');
    expect(actions.at(-1)).toHaveAttribute('aria-label', '工房へ戻る');
    expect(actions.at(-2)).toHaveAttribute('aria-label', supersedesDocumentId ? '改版を破棄' : '削除');
  });

  it.each([401, 403])('connects video link save failure %s to controller revocation', async status => {
    const error = { isAxiosError: true, response: { status } };
    approvalMocks.saveVideos.mockRejectedValueOnce(error);
    const onEditLeaseError = vi.fn(() => true);
    const controller = makeController({ onEditLeaseError });
    render(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    fireEvent.click(screen.getByRole('button', { name: '動画' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '紐づけを保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '紐づけを保存' }));
    await waitFor(() => expect(onEditLeaseError).toHaveBeenCalledWith(error));
  });
  it('keeps workshop context and the return action before editor authentication', () => {
    const navigateBack = vi.fn();
    const controller = makeController({ accessGranted: false, navigateBack });
    render(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} context={{ modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立 › 組立', mode: 'fix' }} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.getByRole('heading', { name: 'DFD1 › 組立 › 組立 › 組立手順書' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(navigateBack).toHaveBeenCalledOnce();
  });

  it('shows deletion only for DRAFT and requires irreversible deletion confirmation', () => {
    const deleteDocument = vi.fn(async () => undefined);
    const view = renderScreen(makeController({ deleteDocument }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(screen.getByText('この要領書を削除します。元に戻せません')).toBeInTheDocument();
    expect(deleteDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(deleteDocument).toHaveBeenCalledOnce();
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={makeController({ document: { ...editorDocument, status: 'published' }, readOnly: true })}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={makeController({ document: { ...editorDocument, supersedesDocumentId: 'root-1' } })}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
  });

  it('disables deletion while busy or read only', () => {
    const view = renderScreen(makeController({ busy: true }));
    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled();
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={makeController({ readOnly: true })}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled();
  });

  it('runs blank-page addition from the page list', () => {
    const addBlankPage = vi.fn(async () => undefined);
    renderScreen(makeController({ addBlankPage }));
    fireEvent.click(screen.getByRole('button', { name: '白紙ページを追加' }));
    expect(addBlankPage).toHaveBeenCalledOnce();
  });
  it('opens the material selector and places the selected material', async () => {
    const placeMaterial = vi.fn(async () => undefined);
    renderScreen(makeController({ placeMaterial }));
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    await waitFor(() => expect(placeMaterial).toHaveBeenCalledWith({ id: 'material', kind: 'PHOTO' }));
  });

  it.each(['place', 'replace'] as const)('closes the shelf and navigates to the created document in %s mode', (mode) => {
    const onNavigateToDocument = vi.fn();
    const controller = makeController({ selectedElement: mode === 'replace' ? { id: 'image', kind: 'IMAGE' } as AssemblyProcedureOverlayElement : null });
    renderScreen(controller, onNavigateToDocument);
    fireEvent.click(screen.getByRole('button', { name: mode === 'replace' ? '素材から差し替え' : /^素材/ }));
    fireEvent.click(screen.getByRole('button', { name: '要領書を作る' }));
    expect(controller.confirmNavigation).toHaveBeenCalledOnce();
    expect(onNavigateToDocument).toHaveBeenCalledExactlyOnceWith('created-document');
    expect(screen.queryByRole('dialog', { name: '素材' })).not.toBeInTheDocument();
  });

  it('keeps the current editor when the unsaved changes navigation guard rejects leaving', () => {
    const onNavigateToDocument = vi.fn();
    const confirmNavigation = vi.fn(() => false);
    renderScreen(makeController({ isDirty: true, confirmNavigation }), onNavigateToDocument);
    fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    fireEvent.click(screen.getByRole('button', { name: '要領書を作る' }));
    expect(confirmNavigation).toHaveBeenCalledOnce();
    expect(onNavigateToDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '素材' })).not.toBeInTheDocument();
  });

  it.each(['place', 'replace'] as const)('forwards a placed material to the controller in %s mode', async (mode) => {
    const placeMaterial = vi.fn(async () => undefined);
    const replaceSelectedImageMaterial = vi.fn(async () => undefined);
    renderScreen(makeController({ placeMaterial, replaceSelectedImageMaterial, selectedElement: {
      id: 'image', kind: 'IMAGE', assetId: 'old', pageIndex: 0, zIndex: 2,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 }
    } }));
    fireEvent.click(screen.getByRole('button', { name: mode === 'replace' ? '素材から差し替え' : '素材' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材' })).getByRole('button', { name: '配置済み素材を選択' }));
    await waitFor(() => expect(mode === 'replace' ? replaceSelectedImageMaterial : placeMaterial).toHaveBeenCalledExactlyOnceWith({ id: 'placed-material', kind: 'PHOTO', documentId: 'old-document', placedAt: '2026-10-05T04:00:00Z' }));
    expect(mode === 'replace' ? placeMaterial : replaceSelectedImageMaterial).not.toHaveBeenCalled();
  });

  it('replaces from the inspector and resets to placement when the toolbar reopens the shelf', async () => {
    const placeMaterial = vi.fn(async () => undefined);
    const replaceSelectedImageMaterial = vi.fn(async () => undefined);
    renderScreen(makeController({ placeMaterial, replaceSelectedImageMaterial, selectedElement: {
      id: 'image', kind: 'IMAGE', assetId: 'old', pageIndex: 0, zIndex: 2,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 }
    } }));
    fireEvent.click(screen.getByRole('button', { name: '素材から差し替え' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材' })).getByRole('button', { name: 'この素材に差し替え' }));
    await waitFor(() => expect(replaceSelectedImageMaterial).toHaveBeenCalledWith({ id: 'material', kind: 'PHOTO' }));
    expect(placeMaterial).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材' })).getByRole('button', { name: '配置' }));
    await waitFor(() => expect(placeMaterial).toHaveBeenCalledWith({ id: 'material', kind: 'PHOTO' }));
    expect(replaceSelectedImageMaterial).toHaveBeenCalledOnce();
  });

  it('keeps the canvas row usable below xl and prevents the editor shell from overflowing', () => {
    window.innerWidth = 900;
    renderScreen(makeController());
    const layout = screen.getByTestId('assembly-document-editor-layout');
    expect(layout).toHaveClass(
      'grid-cols-[120px_minmax(0,1fr)_64px]',
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
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
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
    expect(screen.getByRole('button', { name: '範囲' })).toBeDisabled();
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


  it('exposes the rail actions, selected tools and floating inspector close action', () => {
    const c = makeController({ canSave: true, canUndo: true, canRedo: true, selectionMode: true, selectedElement: { id: 'text', kind: 'TEXT', pageIndex: 0, text: '文字', zIndex: 0, bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 } } });
    renderScreen(c);
    const rail = screen.getByRole('navigation', { name: 'エディタ操作' });
    expect(within(rail).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['保存', '公開', '素材', '動画', '文字', '図形', '範囲', '元に戻す', 'やり直す', '削除', '一覧へ']);
    expect(rail).toHaveClass('pb-[84px]');
    expect(screen.getByRole('button', { name: '一覧へ' })).toHaveClass('!border-transparent', '!text-[#9fadb9]');
    expect(screen.getByRole('button', { name: '削除' })).toHaveClass('!border-transparent', '!text-[#e5484d]');
    expect(screen.getByRole('button', { name: '保存' })).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-save');
    expect(screen.getByRole('button', { name: '公開' })).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-publish');
    expect(screen.getByRole('button', { name: '範囲' })).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-range-add');
    expect(screen.getByRole('button', { name: '範囲' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '文字' }));
    expect(c.addOverlay).toHaveBeenCalledWith('TEXT');
    fireEvent.click(screen.getByRole('button', { name: '図形' }));
    expect(c.addOverlay).toHaveBeenCalledWith('SHAPE');
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    expect(c.undo).toHaveBeenCalledOnce(); expect(c.redo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '属性を閉じる' }));
    expect(c.setSelectedOverlayId).toHaveBeenCalledWith(null);
  });
  it('keeps the return action last and the chat clearance for published documents', () => {
    renderScreen(makeController({ document: { ...editorDocument, status: 'published' }, readOnly: true }));
    const rail = screen.getByRole('navigation', { name: 'エディタ操作' });
    const actions = within(rail).getAllByRole('button');
    expect(actions[0]).toHaveAttribute('aria-label', '保存');
    expect(actions.at(-1)).toHaveAttribute('aria-label', '一覧へ');
    expect(actions.at(-1)).toBeEnabled();
    expect(rail).toHaveClass('pb-[84px]');
    expect(within(rail).queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
  });
  it.each([false, true])('expires success notifications but keeps errors (error=%s)', (messageIsError) => {
    vi.useFakeTimers();
    try {
      renderScreen(makeController({ message: '通知', messageIsError }));
      expect(screen.getByText('通知')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(4000));
      expect(Boolean(screen.queryByText('通知'))).toBe(messageIsError);
    } finally { vi.useRealTimers(); }
  });
  it('leaves the inspector closed when no element is selected', () => {
    renderScreen(makeController());
    expect(screen.queryByTestId('editor-inspector')).not.toBeInTheDocument();
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
