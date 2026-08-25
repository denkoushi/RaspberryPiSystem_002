import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorProvider } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorScreen } from './AssemblyProcedureDocumentEditorScreen';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

vi.mock('./AssemblyProcedureDocumentEditorCanvas', () => ({
  AssemblyProcedureDocumentEditorCanvas: () => <div aria-label="手順書キャンバス" data-testid="editor-canvas" />
}));
vi.mock('./AssemblyProcedureDocumentEditorPageList', () => ({
  AssemblyProcedureDocumentEditorPageList: () => <aside aria-label="手順書ページ一覧" data-testid="editor-page-list" />
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
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    expect(publish).toHaveBeenCalledTimes(1);
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
});
