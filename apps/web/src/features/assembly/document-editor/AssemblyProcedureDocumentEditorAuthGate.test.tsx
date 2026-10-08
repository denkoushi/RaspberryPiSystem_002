import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ getDocument: vi.fn(), verifyPassword: vi.fn(), createRevision: vi.fn() }));
vi.mock('../../../api/client', () => ({
  getAssemblyProcedureDocument: apiMocks.getDocument,
  verifyAssemblyTemplateAccessPassword: apiMocks.verifyPassword,
  createAssemblyProcedureDocumentRevision: apiMocks.createRevision,
  addBlankAssemblyProcedurePage: vi.fn(),
  placeProcedureMaterial: vi.fn(),
  findAssemblyProcedureTextCandidates: vi.fn(),
  createAssemblyProcedureImageRegion: vi.fn(),
  uploadAssemblyProcedureOverlayImage: vi.fn(),
  saveAssemblyProcedureDocumentOverlays: vi.fn(),
  publishAssemblyProcedureDocument: vi.fn(),
  approvePublishAssemblyProcedureDocument: vi.fn(),
  discardAssemblyProcedureDocumentRevision: vi.fn(),
  deleteAssemblyProcedureDocument: vi.fn()
}));
vi.mock('./useAssemblyProcedureDocumentEditLease', () => ({
  useAssemblyProcedureDocumentEditLease: () => ({ mine: true, unavailable: false, handleError: () => false })
}));

import { KIOSK_ASSEMBLY_LIBRARY_PATH } from '../assemblyRoutes';
import { clearProcedureEditorAccess, readProcedureEditorAccess, saveProcedureEditorAccess } from '../procedureEditorAccess';

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

function enter(pin: string) {
  const tenkey = within(screen.getByTestId('assembly-document-editor-password'));
  for (const digit of pin) fireEvent.click(tenkey.getByRole('button', { name: digit, exact: true }));
}

describe('AssemblyProcedureDocumentEditorAuthGate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearProcedureEditorAccess();
    apiMocks.getDocument.mockResolvedValue(documentFixture);
    apiMocks.verifyPassword.mockResolvedValue({ success: true });
    apiMocks.createRevision.mockResolvedValue(documentFixture);
  });
  afterEach(() => clearProcedureEditorAccess());

  it('shows the shared PIN dialog and SOP targets instead of a password input', async () => {
    show();
    const dialog = await screen.findByRole('dialog', { name: '暗証番号' });
    expect(dialog.querySelector('input')).toBeNull();
    expect(screen.queryByText(/管理パスワード/)).not.toBeInTheDocument();
    expect(screen.getByText('この端末で 8 時間有効')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-document-editor-password')).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-password');
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-authenticate');
  });

  it('grants access automatically at four correct digits and retains the PIN for editor commands', async () => {
    show(); await screen.findByRole('dialog');
    enter('2520');
    expect(await screen.findByText('編集可能')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiMocks.verifyPassword).toHaveBeenCalledExactlyOnceWith({ password: '2520' });
    expect(apiMocks.createRevision).toHaveBeenCalledExactlyOnceWith('document-1', '2520');
    expect(readProcedureEditorAccess()?.pin).toBe('2520');
  });

  it('shows 違います for a wrong PIN and leaves access locked', async () => {
    apiMocks.verifyPassword.mockResolvedValue({ success: false });
    show(); await screen.findByRole('dialog');
    enter('0000');
    expect(await screen.findByText('違います')).toBeInTheDocument();
    expect(screen.queryByText('編集可能')).not.toBeInTheDocument();
    expect(apiMocks.createRevision).not.toHaveBeenCalled();
    expect(readProcedureEditorAccess()).toBeNull();
  });

  it('keeps the expiry notice visible inside the dialog during reauthentication', async () => {
    saveProcedureEditorAccess('2520');
    show(); await screen.findByText('編集可能');
    act(() => clearProcedureEditorAccess());
    expect(within(screen.getByRole('dialog')).getByText('認証の期限が切れました。')).toBeInTheDocument();
    let finish!: (result: { success: boolean }) => void;
    apiMocks.verifyPassword.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    enter('2520');
    expect(screen.getByText('認証の期限が切れました。')).toBeInTheDocument();
    await act(async () => { finish({ success: true }); });
    expect(await screen.findByText('編集可能')).toBeInTheDocument();
  });

  it('keeps the loading branch without opening the PIN dialog', () => {
    apiMocks.getDocument.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByText('読込中…')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns to the library without workshop context', async () => {
    show(); await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '一覧へ' }));
    expect(await screen.findByText('手順書一覧')).toBeInTheDocument();
  });

  it('uses the workshop return action with context', async () => {
    show({ modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立', mode: 'fix' });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    await waitFor(() => expect(navigateBack).toHaveBeenCalledOnce());
  });
});
