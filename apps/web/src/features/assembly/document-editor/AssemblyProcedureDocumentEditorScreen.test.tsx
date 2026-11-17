import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalLlmAvailability } from '../../../api/hooks/local-llm';

import { AssemblyProcedureDocumentEditorProvider } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorScreen } from './AssemblyProcedureDocumentEditorScreen';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const approvalMocks = vi.hoisted(() => ({ realCanvas: false, count: vi.fn(async () => 0), read: null as { uid: string } | null, resolve: vi.fn(), materials: vi.fn(async () => []), videos: vi.fn(async () => []), pageVideos: vi.fn(async () => []), saveVideos: vi.fn(), pageRender: vi.fn() }));
vi.mock('../../../api/client', () => ({ resolveProcedureManualApprover: approvalMocks.resolve, countProcedureMaterials: approvalMocks.count, listProcedureWorkInstructionCandidates: async () => ({ items: [] }), listProcedureMaterials: approvalMocks.materials, listProcedureVideos: approvalMocks.videos, getProcedurePageVideos: approvalMocks.pageVideos, replaceProcedurePageVideos: approvalMocks.saveVideos }));
vi.mock('../../kiosk/inventory/setup/useArmedNfcRead', () => ({ useArmedNfcRead: (armed: boolean) => armed ? approvalMocks.read : null }));

vi.mock('./AssemblyProcedureDocumentEditorCanvas', async importOriginal => {
  const actual = await importOriginal<typeof import('./AssemblyProcedureDocumentEditorCanvas')>();
  return { AssemblyProcedureDocumentEditorCanvas: (props: ComponentProps<typeof actual.AssemblyProcedureDocumentEditorCanvas>) => approvalMocks.realCanvas
    ? <actual.AssemblyProcedureDocumentEditorCanvas {...props} />
    : <div aria-label="手順書キャンバス" data-testid="editor-canvas" data-elements={props.elements.map(element => element.id).join(',')} /> };
});
vi.mock('../AssemblyProcedureCanvas', () => ({ AssemblyProcedureCanvas: ({ overlay }: { overlay: ReactNode }) => <div data-testid="editor-page">{overlay}</div> }));
vi.mock('../KioskDocumentPageImage', () => ({ KioskDocumentPageImage: ({ pageUrl }: { pageUrl: string }) => { approvalMocks.pageRender(pageUrl); return <span />; } }));
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
    onClose,
    voiceContext
  }: {
    element: AssemblyProcedureOverlayElement | null;
    onRefetchTextCandidates: () => void;
    onReplaceImage: () => void;
    onBringToFront: (id: string) => void;
    onSendToBack: (id: string) => void;
    onClose: () => void;
    voiceContext?: string;
  }) => (
    <aside aria-label="オーバーレイ編集" data-testid="editor-inspector" data-voice-context={voiceContext}>
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
    layoutSuggestions: {
      state: { status: 'idle' }, locked: false, canSuggest: false,
      start: vi.fn(async () => undefined), cancel: vi.fn(), apply: vi.fn(),
      previewElements: null, showBefore: vi.fn(), selectOption: vi.fn(), appliedCaptionElementIds: []
    },
    onEditLeaseError: vi.fn(() => false),
    beginOverlayDrag: vi.fn(),
    endOverlayDrag: vi.fn(),
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    addOverlay: vi.fn(),
    duplicateSelectedOverlay: vi.fn(),
    duplicateOverlayToCurrentPage: vi.fn(),
    messageIsError: false,
    addBlankPage: vi.fn(async () => undefined),
    deletePage: vi.fn(async () => undefined),
    placeMaterial: vi.fn(async () => undefined),
    replaceSelectedImageMaterial: vi.fn(async () => undefined),
    document: editorDocument,
    pages: editorDocument.pages,
    loading: false,
    accessGranted: true,
    busy: false,
    saving: false,
    registerInlineTextFlush: vi.fn(),
    commitInlineText: vi.fn(),
    message: null,
    conflict: false,
    conflictEditVersion: null,
    reloadConflict: vi.fn(async () => undefined),
    retryConflictSave: vi.fn(async () => undefined),
    passwordInput: '1234',
    setPasswordInput: vi.fn(),
    verifyEditorPassword: vi.fn(async () => true),
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

const interactiveText: AssemblyProcedureOverlayElement = { id: 'text', kind: 'TEXT', text: '元の本文', pageIndex: 0, zIndex: 0, bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.2 } };
function renderInteractive(overrides: Partial<AssemblyProcedureDocumentEditorController> = {}) {
  approvalMocks.realCanvas = true;
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly isPrimary: boolean;
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.isPrimary = init.isPrimary ?? true;
      this.pointerId = init.pointerId ?? 0;
    }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
  const c = makeController({ elements: [interactiveText], selectedPageElements: [interactiveText], ...overrides });
  const select = c.setSelectedOverlayId;
  function Harness() {
    const [selected, setSelected] = useState<string | null>('text');
    return <AssemblyProcedureDocumentEditorProvider value={{ ...c, selectedOverlayId: selected,
      selectedElement: selected ? interactiveText : null,
      setSelectedOverlayId: id => { select(id); setSelected(id); }
    }}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>;
  }
  const view = render(<Harness />);
  for (const node of view.container.querySelectorAll<HTMLElement>('*')) {
    node.setPointerCapture = vi.fn();
    node.releasePointerCapture = vi.fn();
    node.hasPointerCapture = vi.fn(() => true);
  }
  return c;
}
afterEach(() => { approvalMocks.realCanvas = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AssemblyProcedureDocumentEditorScreen', () => {
  it('opens page deletion with the unsaved thumbnail and cancels or deletes the selected page', () => {
    const draft = { id: 'delete-preview', pageIndex: 0, kind: 'TEXT' as const, text: '削除前の未保存', bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.2 }, zIndex: 0 };
    const pages = [editorDocument.pages[0], { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [] }];
    const controller = makeController({ pages, elements: [draft], document: { ...editorDocument, pages } });
    render(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'このページを削除' }));
    const dialog = screen.getByRole('dialog', { name: '1ページ目を削除' });
    expect(within(dialog).getByText('削除前の未保存')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'やめる' }));
    expect(screen.queryByRole('dialog', { name: '1ページ目を削除' })).not.toBeInTheDocument();
    expect(controller.deletePage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'このページを削除' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '1ページ目を削除' })).getByRole('button', { name: '削除する' }));
    expect(controller.deletePage).toHaveBeenCalledWith(0);
  });

  it.each([
    { busy: true }, { saving: true }, { editLeaseMine: false }
  ])('preserves selection while canvas is disabled: %j', overrides => {
    const c = renderInteractive(overrides);
    fireEvent.pointerDown(screen.getByTestId('document-editor-overlay-surface'), { button: 0 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-inspector')).toBeInTheDocument();
  });

  it('preserves selection on a non-primary pointer', () => {
    const c = renderInteractive();
    fireEvent.pointerDown(screen.getByTestId('document-editor-overlay-surface'), { button: 0, isPrimary: false });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-inspector')).toBeInTheDocument();
  });

  it.each(['move', 'resize'])('preserves selection during %s and allows deselection after it ends', interaction => {
    const c = renderInteractive();
    const target = within(screen.getByRole('region', { name: '手順書キャンバス' })).getByTestId(interaction === 'move' ? 'assembly-procedure-overlay-text' : 'assembly-procedure-overlay-text-resize-se');
    fireEvent.pointerDown(target, { button: 0, clientX: 200, clientY: 200 });
    expect(c.beginOverlayDrag).toHaveBeenCalledOnce();
    vi.mocked(c.setSelectedOverlayId).mockClear();
    fireEvent.pointerDown(screen.getByRole('region', { name: '手順書キャンバス' }), { button: 0 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
    expect(c.endOverlayDrag).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-inspector')).toBeInTheDocument();
    fireEvent.pointerUp(target, { clientX: 220, clientY: 200 });
    expect(c.endOverlayDrag).toHaveBeenCalledOnce();
    fireEvent.pointerDown(screen.getByRole('region', { name: '手順書キャンバス' }), { button: 0 });
    expect(c.setSelectedOverlayId).toHaveBeenCalledWith(null);
    expect(screen.queryByTestId('editor-inspector')).not.toBeInTheDocument();
  });

  it('allows Escape deselection after an overlay interaction ends', () => {
    const c = renderInteractive();
    const handle = screen.getByTestId('assembly-procedure-overlay-text-resize-se');
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalledWith(null);
    fireEvent.pointerUp(handle, { clientX: 450, clientY: 350 });
    expect(c.endOverlayDrag).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(c.setSelectedOverlayId).toHaveBeenCalledWith(null);
    expect(screen.queryByTestId('editor-inspector')).not.toBeInTheDocument();
  });

  it('preserves selection on resize handles using their dedicated attribute', () => {
    const c = renderInteractive();
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const handle = screen.getByTestId(`assembly-procedure-overlay-text-resize-${corner}`);
      expect(handle).toHaveAttribute('data-overlay-resize-handle');
      handle.removeAttribute('data-testid');
      fireEvent.pointerDown(handle, { button: 0, clientX: 400, clientY: 300 });
      expect(c.setSelectedOverlayId).not.toHaveBeenCalledWith(null);
      fireEvent.pointerUp(handle, { clientX: 450, clientY: 350 });
    }
    expect(screen.getByTestId('editor-inspector')).toBeInTheDocument();
  });

  it.each(['page', 'surround'])('deselects on blank %s space and keeps the canvas geometry classes', target => {
    const c = renderInteractive();
    const section = screen.getByRole('region', { name: '手順書キャンバス' });
    const classes = section.className;
    fireEvent.pointerDown(target === 'page' ? screen.getByTestId('document-editor-overlay-surface') : section, { button: 0 });
    expect(c.setSelectedOverlayId).toHaveBeenCalledWith(null);
    expect(screen.queryByTestId('editor-inspector')).not.toBeInTheDocument();
    expect(section.className).toBe(classes);
    expect(within(screen.getByTestId('assembly-document-editor-details')).getByText('組立手順書')).toBeInTheDocument();
  });

  it('selects overlays and preserves selection on resize handles', () => {
    const c = renderInteractive();
    const overlay = within(screen.getByRole('region', { name: '手順書キャンバス' })).getByTestId('assembly-procedure-overlay-text');
    fireEvent.pointerDown(overlay, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(overlay, { clientX: 220, clientY: 200 });
    fireEvent.click(overlay);
    const handle = screen.getByTestId('assembly-procedure-overlay-text-resize-se');
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(handle, { clientX: 450, clientY: 350 });
    expect(c.setSelectedOverlayId).toHaveBeenCalledWith('text');
    expect(c.setSelectedOverlayId).not.toHaveBeenCalledWith(null);
    expect(screen.getByTestId('editor-inspector')).toBeInTheDocument();
  });

  it('preserves selection on conflict message buttons and approval labels', () => {
    const c = renderInteractive({ message: '競合', conflict: true, conflictEditVersion: 3,
      document: { ...editorDocument, lastApproval: { employeeName: '承認者', approvedAt: '2026-10-05T09:00:00Z' } } });
    for (const button of within(screen.getByRole('alert')).getAllByRole('button')) {
      fireEvent.pointerDown(button, { button: 0 });
    }
    fireEvent.click(screen.getByRole('button', { name: '保持内容を再保存' }));
    expect(c.retryConflictSave).toHaveBeenCalledOnce();
    fireEvent.pointerDown(screen.getByText(/承認: 承認者/), { button: 0 });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
  });

  it('preserves selection on unlocked layout suggestion controls', () => {
    const c = makeController();
    const controller = renderInteractive({ layoutSuggestions: { ...c.layoutSuggestions, state: { status: 'error', message: '配置エラー' } } });
    const button = within(screen.getByRole('alert', { name: '配置の提案' })).getByRole('button');
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.click(button);
    expect(controller.layoutSuggestions.cancel).toHaveBeenCalledOnce();
    expect(controller.setSelectedOverlayId).not.toHaveBeenCalled();
  });

  it('keeps range dragging active without clearing the selected overlay', () => {
    const c = renderInteractive({ selectionMode: true });
    const range = screen.getByRole('application', { name: 'オーバーレイ範囲選択面' });
    fireEvent.pointerDown(range, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(range, { clientX: 500, clientY: 400 });
    fireEvent.pointerUp(range, { clientX: 500, clientY: 400 });
    expect(c.handleRangeSelected).toHaveBeenCalledExactlyOnceWith({ xRatio: 0.1, yRatio: 0.1, widthRatio: 0.4, heightRatio: expect.closeTo(0.3) });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
  });

  it.each(['page', 'surround'])('commits inline text before deselecting on blank %s space', target => {
    const c = renderInteractive();
    fireEvent.keyDown(within(screen.getByRole('region', { name: '手順書キャンバス' })).getByTestId('assembly-procedure-overlay-text'), { key: 'Enter' });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '保持する本文' } });
    fireEvent.pointerDown(input, { button: 0 });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
    fireEvent.pointerDown(target === 'page' ? screen.getByTestId('document-editor-overlay-surface') : screen.getByRole('region', { name: '手順書キャンバス' }), { button: 0 });
    expect(c.commitInlineText).toHaveBeenCalledExactlyOnceWith({ ...interactiveText, text: '保持する本文' });
    expect(vi.mocked(c.commitInlineText).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(c.setSelectedOverlayId).mock.invocationCallOrder[0]!);
    expect(screen.queryByTestId('editor-inspector')).not.toBeInTheDocument();
  });

  it('deselects with Escape', () => {
    const c = renderInteractive();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(c.setSelectedOverlayId).toHaveBeenCalledWith(null);
    expect(screen.queryByTestId('editor-inspector')).not.toBeInTheDocument();
  });

  it('keeps selection when Escape closes a dialog', () => {
    const c = renderInteractive();
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: '要領書を削除' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-inspector')).toBeInTheDocument();
  });

  it('prioritizes inline text Escape and focused inputs over deselection', () => {
    const c = renderInteractive();
    fireEvent.keyDown(within(screen.getByRole('region', { name: '手順書キャンバス' })).getByTestId('assembly-procedure-overlay-text'), { key: 'Enter' });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '取消する本文' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
    expect(c.commitInlineText).not.toHaveBeenCalled();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    field.remove();
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
  });

  it('preserves selection on blank space and Escape while layout is locked', () => {
    const base = makeController();
    const c = renderInteractive({ layoutSuggestions: { ...base.layoutSuggestions, locked: true } });
    fireEvent.pointerDown(screen.getByRole('region', { name: '手順書キャンバス' }), { button: 0 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(c.setSelectedOverlayId).not.toHaveBeenCalled();
  });

  it('keeps the title fallback in the empty details column', () => {
    renderScreen(makeController({ document: { ...editorDocument, name: null } }));
    const details = screen.getByTestId('assembly-document-editor-details');
    expect(details).toHaveClass('max-[1099px]:hidden');
    expect(details).toHaveTextContent(/^手順書$/);
    expect(within(details).queryByTestId('editor-inspector')).not.toBeInTheDocument();
  });

  it('shows one AI tooltip on 整える and still requests a layout', () => {
    vi.mocked(useLocalLlmAvailability).mockReturnValue({ unavailable: true });
    const c = makeController();
    c.layoutSuggestions.canSuggest = true;
    renderScreen(c);
    const button = screen.getByRole('button', { name: '整える', exact: true });
    expect(button).toHaveAccessibleDescription('AI 未起動');
    expect(button).toHaveTextContent('!');
    fireEvent.pointerEnter(button);
    expect(screen.getAllByRole('tooltip').filter(tip => tip.textContent === 'AI 未起動')).toHaveLength(1);
    expect(screen.queryByRole('tooltip', { name: '整える' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(c.layoutSuggestions.start).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '音声入力', exact: true })).not.toHaveAccessibleDescription('AI 未起動');
  });

  beforeEach(() => {
    approvalMocks.count.mockReset().mockResolvedValue(0);
    approvalMocks.materials.mockReset().mockResolvedValue([]);
    vi.mocked(useLocalLlmAvailability).mockReturnValue({ unavailable: false }); localStorage.clear(); approvalMocks.read = null; approvalMocks.resolve.mockReset(); });
  it('redraws only the edited page thumbnail and keeps the toolbar stable while typing', () => {
    const first: AssemblyProcedureOverlayElement = { id: 'first', kind: 'TEXT', text: '文章', pageIndex: 0, zIndex: 0, bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.2 } };
    const second = { ...first, id: 'second', pageIndex: 1 };
    const pages = [editorDocument.pages[0], { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [] }];
    const controller = makeController({ pages, elements: [first, second], selectedElement: first, selectedOverlayId: first.id, selectedPageElements: [first], canSave: true, canUndo: true });
    const onNavigate = vi.fn();
    const view = renderScreen(controller, onNavigate);
    approvalMocks.pageRender.mockClear();
    vi.mocked(useLocalLlmAvailability).mockClear();
    const edited = { ...first, text: '文章あ' };
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={{ ...controller, elements: [edited, second], selectedElement: edited, selectedPageElements: [edited] }}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={onNavigate} /></AssemblyProcedureDocumentEditorProvider>);
    expect(approvalMocks.pageRender.mock.calls).toEqual([['/pages/1.png']]);
    expect(useLocalLlmAvailability).not.toHaveBeenCalled();
    expect(screen.getAllByText('文章あ').length).toBeGreaterThan(0);
  });

  it('closes and reopens the parts pane and persists its state', () => {
    const view = renderScreen(makeController());
    expect(screen.getByRole('listbox', { name: 'このページの部品' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '部品を閉じる' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('assembly-document-editor-layout')).toHaveClass('grid-cols-[120px_0_minmax(0,1fr)_var(--details-width)_64px]');
    expect(localStorage.getItem('assembly-document-editor-parts-pane')).toBe('closed');
    view.unmount();
    renderScreen(makeController());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '部品を開く' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(localStorage.getItem('assembly-document-editor-parts-pane')).toBe('open');
  });

  it('wires all draft pages and reuse, selects the visible copy without inheriting hiding', () => {
    const source: AssemblyProcedureOverlayElement = { id: 'source', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, zIndex: 2, bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 } };
    const copy = { ...source, id: 'copy', pageIndex: 1, zIndex: 0 };
    const controller = makeController({ elements: [source], selectedPageElements: [source], selectedOverlayId: source.id });
    const view = renderScreen(controller);
    fireEvent.click(screen.getByRole('button', { name: '隠す' }));
    const next = { ...controller, selectedPageIndex: 1, selectedPage: { pageIndex: 1, imageRelativePath: '/pages/2.png', overlays: [] }, selectedPageElements: [], selectedOverlayId: null };
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={next}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'ほか 1' }));
    expect(screen.getByRole('heading', { name: 'p1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option'));
    expect(controller.duplicateOverlayToCurrentPage).toHaveBeenCalledExactlyOnceWith('source');
    const copied = { ...next, elements: [source, copy], selectedPageElements: [copy], selectedOverlayId: copy.id, selectedElement: copy };
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={copied}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.getByRole('listbox', { name: 'このページの部品' })).toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option')).not.toHaveClass('opacity-40');
    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-elements', 'copy');
    expect(screen.getByRole('button', { name: 'このページ 1' })).toBeInTheDocument();
    expect(source.pageIndex).toBe(0);
  });

  it.each(['getItem', 'setItem'] as const)('keeps pane controls usable when storage %s fails', method => {
    const storage = vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('storage unavailable'); });
    try {
      renderScreen(makeController());
      fireEvent.click(screen.getByRole('button', { name: '部品を閉じる' }));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    } finally { storage.mockRestore(); }
  });

  it('hides only the canvas element, clears selection and lets the hidden part be shown again', () => {
    const element: AssemblyProcedureOverlayElement = { id: 'part', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, zIndex: 2, bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 } };
    const controller = makeController({ elements: [element], selectedPageElements: [element], selectedOverlayId: element.id, selectedElement: element });
    renderScreen(controller);
    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-elements', 'part');
    fireEvent.click(screen.getByRole('button', { name: '隠す' }));
    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-elements', '');
    expect(controller.setSelectedOverlayId).toHaveBeenCalledExactlyOnceWith(null);
    const row = screen.getByRole('option');
    expect(row).toHaveClass('opacity-40');
    expect(within(row).getByTestId('assembly-procedure-overlay-part')).toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: '手順書ページ一覧' })).getByTestId('assembly-procedure-overlay-part')).toBeInTheDocument();
    fireEvent.click(row);
    expect(controller.setSelectedOverlayId).toHaveBeenLastCalledWith('part');
    fireEvent.click(screen.getByRole('button', { name: '出す' }));
    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-elements', 'part');
    expect(row).not.toHaveClass('opacity-40');
    expect(controller.elements).toEqual([element]);
  });

  it.each(['page', 'document'] as const)('clears temporary hiding after a %s change', change => {
    const element: AssemblyProcedureOverlayElement = { id: 'part', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, zIndex: 2, bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 } };
    const controller = makeController({ elements: [element], selectedPageElements: [element], selectedOverlayId: element.id });
    const view = renderScreen(controller);
    fireEvent.click(screen.getByRole('button', { name: '隠す' }));
    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-elements', '');
    const next = change === 'page' ? { ...controller, selectedPageIndex: 1, selectedPage: { ...controller.selectedPage!, pageIndex: 1 }, selectedPageElements: [] } : { ...controller, document: { ...editorDocument, id: 'document-2' } };
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={next}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={{ ...controller, document: next.document }}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-elements', 'part');
    expect(screen.getByRole('option')).not.toHaveClass('opacity-40');
  });

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
  it('keeps the canvas clear of the inspector while an element is selected', () => {
    const element: AssemblyProcedureOverlayElement = {
      id: 'overlay', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, zIndex: 0,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 }
    };
    const { unmount } = renderScreen(makeController({ selectedElement: element }));
    expect(screen.getByRole('region', { name: '手順書キャンバス' })).toHaveClass('p-2');
    expect(screen.getByRole('region', { name: '手順書キャンバス' })).not.toHaveClass('pr-[372px]');
    const details = screen.getByTestId('assembly-document-editor-details');
    expect(details).toHaveClass('max-[1099px]:absolute', 'max-[1099px]:col-auto', 'max-[1099px]:right-20', 'max-[1099px]:w-[340px]', 'max-[1099px]:max-w-[calc(100%-480px)]');
    expect(details).not.toHaveClass('max-[1099px]:hidden');
    expect(within(details).getByTestId('editor-inspector')).toBeInTheDocument();
    unmount();
    renderScreen(makeController({ selectedElement: null }));
    expect(screen.getByRole('region', { name: '手順書キャンバス' })).not.toHaveClass('pr-[372px]');
  });
  it.each([['make', 1, null, '作る · 下書き 第1版', 'text-[#3ba776]'], ['fix', 3, 'root', '直す · 改版の下書き 第3版', 'text-[#f6b93b]'], ['fix', 1, null, '直す · 下書き 第1版', 'text-[#f6b93b]']] as const)('shows workshop context for %s', (mode, revisionNumber, supersedesDocumentId, label, color) => {
    const controller = makeController({ document: { ...editorDocument, revisionNumber, supersedesDocumentId } });
    render(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} context={{ modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立 › 組立', mode }} /></AssemblyProcedureDocumentEditorProvider>);
    expect(within(screen.getByTestId('assembly-document-editor-details')).getByText('DFD1 › 組立 › 組立 › 組立手順書')).toHaveClass('whitespace-normal', 'break-words');
    expect(screen.getByText(label)).toHaveClass(color);
    const actions = within(screen.getByRole('navigation', { name: 'エディタ操作' })).getAllByRole('button');
    expect(actions[0]).toHaveAttribute('aria-label', '工房へ戻る');
    expect(actions[1]).toHaveAttribute('aria-label', '保存済み');
    expect(actions.at(-1)).toHaveAttribute('aria-label', supersedesDocumentId ? '改版を破棄する' : '削除する');
  });

  it.each([
    ['組立 › 組立', 'procedure-assembly'], ['研削 › 平面研削', 'procedure-grinding'],
    [' › 組立', 'procedure-assembly'], ['工程 › 研削', 'procedure-grinding'],
    ['切削', undefined], [undefined, undefined]
  ])('passes only known department context to voice input (%s)', (processName, expected) => {
    const element = { id: 'text', kind: 'TEXT', text: '手順', pageIndex: 0, zIndex: 0, bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 } } as const;
    const controller = makeController({ selectedElement: element });
    const context = processName === undefined ? undefined : { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'process', processName, mode: 'fix' as const };
    render(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} context={context} /></AssemblyProcedureDocumentEditorProvider>);
    if (expected) expect(screen.getByTestId('editor-inspector')).toHaveAttribute('data-voice-context', expected);
    else expect(screen.getByTestId('editor-inspector')).not.toHaveAttribute('data-voice-context');
  });

  it.each([401, 403])('connects video link save failure %s to controller revocation', async status => {
    const error = { isAxiosError: true, response: { status } };
    approvalMocks.saveVideos.mockRejectedValueOnce(error);
    const onEditLeaseError = vi.fn(() => true);
    const controller = makeController({ onEditLeaseError });
    render(<AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    fireEvent.click(screen.getByRole('button', { name: '動画をつなぐ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '紐づけを保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '紐づけを保存' }));
    await waitFor(() => expect(onEditLeaseError).toHaveBeenCalledWith(error));
  });
  it('keeps workshop context and the return action before editor authentication', () => {
    const navigateBack = vi.fn();
    const controller = makeController({ accessGranted: false, navigateBack });
    render(<MemoryRouter><AssemblyProcedureDocumentEditorProvider value={controller}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} context={{ modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立 › 組立', mode: 'fix' }} /></AssemblyProcedureDocumentEditorProvider></MemoryRouter>);
    expect(screen.getByRole('dialog', { name: '暗証番号' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(navigateBack).toHaveBeenCalledOnce();
  });

  it('shows deletion only for DRAFT and requires irreversible deletion confirmation', () => {
    const deleteDocument = vi.fn(async () => undefined);
    const view = renderScreen(makeController({ deleteDocument }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(screen.getByText('この要領書を削除します。元に戻せません')).toBeInTheDocument();
    expect(deleteDocument).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '削除する' }));
    expect(deleteDocument).toHaveBeenCalledOnce();
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={makeController({ document: { ...editorDocument, status: 'published' }, readOnly: true })}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument();
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={makeController({ document: { ...editorDocument, supersedesDocumentId: 'root-1' } })}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument();
  });

  it('disables deletion while busy or read only', () => {
    const view = renderScreen(makeController({ busy: true }));
    expect(screen.getByRole('button', { name: '削除する' })).toBeDisabled();
    view.rerender(<AssemblyProcedureDocumentEditorProvider value={makeController({ readOnly: true })}><AssemblyProcedureDocumentEditorScreen onNavigateToDocument={vi.fn()} /></AssemblyProcedureDocumentEditorProvider>);
    expect(screen.getByRole('button', { name: '削除する' })).toBeDisabled();
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
    fireEvent.click(screen.getByRole('button', { name: '素材を置く' }));
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    await waitFor(() => expect(placeMaterial).toHaveBeenCalledWith({ id: 'material', kind: 'PHOTO' }));
  });

  it.each(['place', 'replace'] as const)('closes the shelf and navigates to the created document in %s mode', async (mode) => {
    const onNavigateToDocument = vi.fn();
    const controller = makeController({ selectedElement: mode === 'replace' ? { id: 'image', kind: 'IMAGE' } as AssemblyProcedureOverlayElement : null });
    renderScreen(controller, onNavigateToDocument);
    fireEvent.click(screen.getByRole('button', { name: mode === 'replace' ? '素材から差し替え' : '素材を置く' }));
    fireEvent.click(screen.getByRole('button', { name: '要領書を作る' }));
    expect(controller.confirmNavigation).toHaveBeenCalledOnce();
    await waitFor(() => expect(onNavigateToDocument).toHaveBeenCalledExactlyOnceWith('created-document'));
    expect(screen.queryByRole('dialog', { name: '素材' })).not.toBeInTheDocument();
  });

  it('keeps the current editor when the unsaved changes navigation guard rejects leaving', () => {
    const onNavigateToDocument = vi.fn();
    const confirmNavigation = vi.fn(() => false);
    renderScreen(makeController({ isDirty: true, confirmNavigation }), onNavigateToDocument);
    fireEvent.click(screen.getByRole('button', { name: '素材を置く' }));
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
    fireEvent.click(screen.getByRole('button', { name: mode === 'replace' ? '素材から差し替え' : '素材を置く' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材' })).getByRole('button', { name: '配置済み素材を選択' }));
    await waitFor(() => expect(mode === 'replace' ? replaceSelectedImageMaterial : placeMaterial).toHaveBeenCalledExactlyOnceWith({ id: 'placed-material', kind: 'PHOTO', documentId: 'old-document', placedAt: '2026-10-05T04:00:00Z' }));
    expect(mode === 'replace' ? placeMaterial : replaceSelectedImageMaterial).not.toHaveBeenCalled();
  });

  it('loads material cards lazily and refreshes the tab and toolbar after placement', async () => {
    const material = { id: 'unplaced', kind: 'TEXT', text: '新しい素材', placedAt: null, discardedAt: null, documentId: null };
    approvalMocks.materials.mockResolvedValue([material] as never);
    approvalMocks.count.mockResolvedValue(1);
    const c = makeController({ placeMaterial: vi.fn(async () => { approvalMocks.materials.mockResolvedValue([]); approvalMocks.count.mockResolvedValue(0); }) });
    renderScreen(c);
    await waitFor(() => expect(approvalMocks.count).toHaveBeenCalledExactlyOnceWith({ state: 'unplaced' }));
    expect(screen.queryByRole('button', { name: '素材を置く: 新しい素材' })).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('button', { name: '素材を置く', exact: true })).getByText('1', { exact: true })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '素材', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: '素材を置く: 新しい素材' }));
    await waitFor(() => expect(c.placeMaterial).toHaveBeenCalledExactlyOnceWith(material));
    await waitFor(() => expect(screen.queryByRole('button', { name: '素材を置く: 新しい素材' })).not.toBeInTheDocument());
    expect(approvalMocks.materials).toHaveBeenCalledTimes(2);
    expect(approvalMocks.count.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(within(screen.getByRole('button', { name: '素材を置く', exact: true })).queryByText('1', { exact: true })).not.toBeInTheDocument());
  });

  it.each([{ readOnly: true }, { busy: true }, { conflict: true }, { editLeaseMine: false }])('blocks material placement for %j', async flags => {
    approvalMocks.materials.mockResolvedValue([{ id: 'unplaced', kind: 'TEXT', text: '新しい素材' }] as never);
    const c = makeController(flags);
    renderScreen(c);
    fireEvent.click(screen.getByRole('button', { name: '素材', exact: true }));
    const card = await screen.findByRole('button', { name: '素材を置く: 新しい素材' });
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(c.placeMaterial).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole('button', { name: '素材を置く' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材' })).getByRole('button', { name: '配置' }));
    await waitFor(() => expect(placeMaterial).toHaveBeenCalledWith({ id: 'material', kind: 'PHOTO' }));
    expect(replaceSelectedImageMaterial).toHaveBeenCalledOnce();
  });

  it('keeps the canvas row usable below xl and prevents the editor shell from overflowing', () => {
    window.innerWidth = 900;
    renderScreen(makeController());
    const layout = screen.getByTestId('assembly-document-editor-layout');
    expect(layout).toHaveClass(
      'grid-cols-[120px_280px_minmax(0,1fr)_var(--details-width)_64px]',
      '[--details-width:min(400px,26vw)]',
      'max-[1099px]:[--details-width:0px]',
      'overflow-hidden'
    );
    expect(screen.getByTestId('editor-canvas')).toBeVisible();
    expect(screen.getByRole('region', { name: '手順書キャンバス' })).toBeInTheDocument();
  });

  it('routes an unsaved back action through the navigation guard', () => {
    const navigateBack = vi.fn();
    const confirmNavigation = vi.fn(() => true);
    renderScreen(makeController({ isDirty: true, navigateBack, confirmNavigation }));
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }));
    expect(navigateBack).toHaveBeenCalledTimes(1);
  });

  it('requires explicit confirmation before publishing', () => {
    const publish = vi.fn(async () => undefined);
    renderScreen(makeController({ publish }));
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    expect(screen.getByRole('dialog', { name: '手順書を公開' })).toBeInTheDocument();
    expect(screen.getByText(/公開すると/)).toBeInTheDocument();
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '社員タグで承認して公開' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'パスワードで公開(締付テンプレート向け)' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '手順書を公開' })).getByRole('button', { name: '公開する' }));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('reads an employee tag, confirms name and position, then publishes with an optional comment', async () => {
    approvalMocks.resolve.mockResolvedValue({ displayName: '承認太郎', positionName: '班長', rank: 'leader' });
    const publish = vi.fn(async () => true);
    const controller = makeController({ publish });
    const view = renderScreen(controller);
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
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
    expect(screen.getByRole('button', { name: '範囲を選ぶ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存済み' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '公開する' })).toBeDisabled();
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


  it('shows pending arranging in a small panel and locks page and tool actions', () => {
    const c = makeController({ readOnly: true });
    c.layoutSuggestions = { ...c.layoutSuggestions, locked: true, state: { status: 'pending', seconds: 7 } };
    renderScreen(c);
    expect(screen.getByText('配置を考えています 7秒')).toBeInTheDocument();
    for (const button of within(screen.getByRole('navigation', { name: 'エディタ操作' })).getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: '1ページ目（選択中）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '部品を閉じる' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(c.layoutSuggestions.cancel).toHaveBeenCalledOnce();
  });

  it('shows proposals on the canvas and routes before/after, apply and cancel actions', () => {
    const c = makeController({ readOnly: true });
    const proposed: AssemblyProcedureOverlayElement[] = [{ id: 'proposal', kind: 'TEXT', pageIndex: 0, text: '手順', zIndex: 0, bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.8, heightRatio: 0.2 } }];
    c.layoutSuggestions = { ...c.layoutSuggestions, locked: true, previewElements: proposed, state: { status: 'preview', before: false, suggestion: { elements: proposed, addedElementIds: [], changes: ['文章を写真の右にそろえた'] } } };
    renderScreen(c);
    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-elements', 'proposal');
    expect(screen.getByText('文章を写真の右にそろえた')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '配置案' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '後', exact: true }));
    expect(c.layoutSuggestions.showBefore).toHaveBeenNthCalledWith(1, true);
    expect(c.layoutSuggestions.showBefore).toHaveBeenNthCalledWith(2, false);
    fireEvent.click(screen.getByRole('button', { name: 'これにする' }));
    expect(c.layoutSuggestions.apply).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(c.layoutSuggestions.cancel).toHaveBeenCalledOnce();
  });

  it('shows arranging failures next to the canvas and closes them', () => {
    const c = makeController();
    c.layoutSuggestions.state = { status: 'error', message: 'このページは1枚に収まりません' };
    renderScreen(c);
    expect(screen.getByRole('alert')).toHaveTextContent('このページは1枚に収まりません');
    fireEvent.click(screen.getByRole('button', { name: '閉じる', exact: true }));
    expect(c.layoutSuggestions.cancel).toHaveBeenCalledOnce();
  });

  it('keeps back first, delete last and chat clearance while exposing selected tools and the inspector close action', () => {
    const c = makeController({ canSave: true, canUndo: true, canRedo: true, selectionMode: true, selectedElement: { id: 'text', kind: 'TEXT', pageIndex: 0, text: '文字', zIndex: 0, bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 } } });
    renderScreen(c);
    const rail = screen.getByRole('navigation', { name: 'エディタ操作' });
    expect(within(rail).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['一覧へ戻る', '保存済み', '公開する', '素材を置く', '動画をつなぐ', '文字を置く', '図形を置く', '範囲を選ぶ', '整える', '音声入力', '元に戻す', 'やり直す', '削除する']);
    expect(screen.getByRole('button', { name: '整える' })).toHaveClass('!border-[#5fc3e8]', '!text-[#5fc3e8]');
    expect(rail).toHaveClass('pb-[84px]');
    for (const button of within(rail).getAllByRole('button')) expect(button).not.toHaveAttribute('title');
    expect(screen.getByRole('button', { name: '一覧へ戻る' })).toHaveClass('!border-transparent', '!text-[#9fadb9]');
    expect(screen.getByRole('button', { name: '削除する' })).toHaveClass('!border-transparent', '!text-[#e5484d]');
    expect(screen.getByRole('button', { name: '保存済み' })).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-save');
    expect(screen.getByRole('button', { name: '公開する' })).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-publish');
    expect(screen.getByRole('button', { name: '範囲を選ぶ' })).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-range-add');
    expect(screen.getByRole('button', { name: '範囲を選ぶ' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '文字を置く' }));
    expect(c.addOverlay).toHaveBeenCalledWith('TEXT');
    fireEvent.click(screen.getByRole('button', { name: '図形を置く' }));
    expect(c.addOverlay).toHaveBeenCalledWith('SHAPE');
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    expect(c.undo).toHaveBeenCalledOnce(); expect(c.redo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '属性を閉じる' }));
    expect(c.setSelectedOverlayId).toHaveBeenCalledWith(null);
  });
  it('keeps back first and chat clearance without a delete action for published documents', () => {
    renderScreen(makeController({ document: { ...editorDocument, status: 'published' }, readOnly: true }));
    const rail = screen.getByRole('navigation', { name: 'エディタ操作' });
    const actions = within(rail).getAllByRole('button');
    expect(actions[0]).toHaveAttribute('aria-label', '一覧へ戻る');
    expect(actions[1]).toHaveAttribute('aria-label', '保存済み');
    expect(actions.at(-1)).toHaveAttribute('aria-label', 'やり直す');
    expect(actions[0]).toBeEnabled();
    expect(rail).toHaveClass('pb-[84px]');
    expect(within(rail).queryByRole('button', { name: '削除する' })).not.toBeInTheDocument();
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
  it('persists the per-device voice toggle and restores it on remount', () => {
    localStorage.removeItem('assembly-document-editor-voice-input');
    const view = renderScreen(makeController());
    expect(screen.getByRole('button', { name: '音声入力' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '音声入力' }));
    expect(localStorage.getItem('assembly-document-editor-voice-input')).toBe('on');
    view.unmount();
    renderScreen(makeController());
    expect(screen.getByRole('button', { name: '音声入力' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '音声入力' }));
    expect(localStorage.getItem('assembly-document-editor-voice-input')).toBe('off');
  });

  it('keeps the voice toggle usable when localStorage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      renderScreen(makeController());
      expect(screen.getByRole('button', { name: '音声入力' })).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(screen.getByRole('button', { name: '音声入力' }));
      expect(screen.getByRole('button', { name: '音声入力' })).toHaveAttribute('aria-pressed', 'true');
    } finally { get.mockRestore(); set.mockRestore(); }
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
    expect(screen.getByRole('button', { name: '保存済み' })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: '保存済み' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '白紙ページを追加' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '引き継ぐ' }));
    expect(screen.getByRole('dialog', { name: '編集を引き継ぐ' })).toBeInTheDocument();
    expect(takeoverEditLease).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '引き継ぐ' })[1]!);
    await waitFor(() => expect(takeoverEditLease).toHaveBeenCalledOnce());
  });
});

vi.mock('../../../api/hooks/local-llm', () => ({ useLocalLlmAvailability: vi.fn(() => ({ unavailable: false })) }));
