import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ getDocument: vi.fn(), createRevision: vi.fn() }));
vi.mock('../../../api/client', () => ({
  getAssemblyProcedureDocument: apiMocks.getDocument,
  createAssemblyProcedureDocumentRevision: apiMocks.createRevision,
  addBlankAssemblyProcedurePage: vi.fn(),
  placeProcedureMaterial: vi.fn(),
  findAssemblyProcedureTextCandidates: vi.fn(),
  createAssemblyProcedureImageRegion: vi.fn(),
  uploadAssemblyProcedureOverlayImage: vi.fn(),
  saveAssemblyProcedureDocumentOverlays: vi.fn(),
  publishAssemblyProcedureDocument: vi.fn(),
  approvePublishAssemblyProcedureDocument: vi.fn(),
}));
vi.mock('./useAssemblyProcedureDocumentEditLease', () => ({
  useAssemblyProcedureDocumentEditLease: () => ({ mine: true, unavailable: false, handleError: () => false })
}));

import { KIOSK_ASSEMBLY_LIBRARY_PATH } from '../assemblyRoutes';

import { AssemblyProcedureDocumentEditorAuthGate } from './AssemblyProcedureDocumentEditorAuthGate';
import { AssemblyProcedureDocumentEditorProvider } from './AssemblyProcedureDocumentEditorContext';
import { useAssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

import type { ProcedureManualEditorContext } from '../types';

const documentFixture = {
  id: 'document-1', name: '手順書', imageRelativePath: '/pages/1.png', status: 'draft',
  publishedAt: null, isActive: false, isRevisionHead: true, editVersion: 2,
  pages: [{ pageIndex: 0, imageRelativePath: '/pages/1.png', overlays: [] }],
  createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z'
};
const navigateBack = vi.fn();

function Editor({ context }: { context?: ProcedureManualEditorContext }) {
  const controller = useAssemblyProcedureDocumentEditorController({ documentId: documentFixture.id, onNavigateBack: navigateBack });
  return <AssemblyProcedureDocumentEditorProvider value={controller}>
    <AssemblyProcedureDocumentEditorAuthGate context={context} />
    {controller.accessGranted ? <p>編集可能</p> : null}
  </AssemblyProcedureDocumentEditorProvider>;
}

function show(context?: ProcedureManualEditorContext) {
  return render(<MemoryRouter initialEntries={['/edit']}><Routes>
    <Route path="/edit" element={<Editor context={context} />} />
    <Route path={KIOSK_ASSEMBLY_LIBRARY_PATH} element={<p>手順書一覧</p>} />
  </Routes></MemoryRouter>);
}

describe('AssemblyProcedureDocumentEditorAuthGate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.getDocument.mockResolvedValue(documentFixture);
    apiMocks.createRevision.mockResolvedValue(documentFixture);
  });

  it('enters the editor without a PIN and creates the revision with an empty password', async () => {
    show();
    expect(await screen.findByText('編集可能')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiMocks.createRevision).toHaveBeenCalledExactlyOnceWith('document-1', '');
  });

  it('shows the failure message with the back button when the revision cannot be created', async () => {
    apiMocks.createRevision.mockRejectedValue(new Error('失敗'));
    show();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('編集可能')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一覧へ' })).toBeInTheDocument();
  });

  it('keeps the loading branch without opening the PIN dialog', () => {
    apiMocks.getDocument.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByText('読込中…')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns to the library without workshop context', async () => {
    apiMocks.createRevision.mockRejectedValue(new Error('失敗'));
    show(); await screen.findByRole('button', { name: '一覧へ' });
    fireEvent.click(screen.getByRole('button', { name: '一覧へ' }));
    expect(await screen.findByText('手順書一覧')).toBeInTheDocument();
  });

  it('uses the workshop return action with context', async () => {
    apiMocks.createRevision.mockRejectedValue(new Error('失敗'));
    show({ modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立', mode: 'fix' });
    await screen.findByRole('button', { name: '戻る' });
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    await waitFor(() => expect(navigateBack).toHaveBeenCalledOnce());
  });
});
