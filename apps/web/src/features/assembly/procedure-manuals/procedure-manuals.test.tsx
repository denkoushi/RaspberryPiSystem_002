import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureManualAssignmentDialog } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBrowser } from './ProcedureManualBrowser';

import type { ProcedureManualDetailDto, ProcedureManualProcessDto } from '../types';

const mocks = vi.hoisted(() => ({
  models: vi.fn(), processes: vi.fn(), detail: vi.fn(), documents: vi.fn(), pdfs: vi.fn(), save: vi.fn(), history: vi.fn(), blank: vi.fn()
}));
vi.mock('../../../api/client', () => ({
  createBlankAssemblyProcedureDocument: mocks.blank,
  listProcedureManualModels: mocks.models, listProcedureManualProcesses: mocks.processes,
  getProcedureManualAssignments: mocks.detail, listAssemblyProcedureDocumentSummaries: mocks.documents,
  getAssemblyProcedureDocumentRevisions: mocks.history, getKioskDocuments: mocks.pdfs, replaceProcedureManualAssignments: mocks.save
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({
  AssemblyProcedureSequenceViewer: ({ sequence }: { sequence: ProcedureManualDetailDto['sequence'] }) => <div data-testid="sequence-viewer">{sequence.documents.map((d) => <span key={d.orderItemId}>{d.title}</span>)}</div>
}));

const processes: ProcedureManualProcessDto[] = [
  { id: 'parent', parentId: null, name: '組立工程', sortOrder: 0, active: true, resourceCd: null },
  { id: 'assembly', parentId: 'parent', name: '組立工程', sortOrder: 0, active: true, resourceCd: null },
  { id: 'inspection', parentId: 'parent', name: '検査工程', sortOrder: 1, active: true, resourceCd: null }
];
const emptyDetail: ProcedureManualDetailDto = {
  assignments: [], sequence: {
    mode: 'configured', source: 'primary_fallback', reason: null, machineName: 'DFD1', machineNameKey: 'DFD1',
    stepSource: 'document_expansion', steps: [], documents: [], fallbackProcedureDocument: null
  }
};

describe('procedure-manuals', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.models.mockResolvedValue([{ modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1' }, { modelCode: 'DFD2', modelCodeKey: 'DFD2' }]);
    mocks.processes.mockResolvedValue(processes);
    mocks.detail.mockResolvedValue(emptyDetail);
    mocks.documents.mockResolvedValue([
      { id: 'v2', revisionRootId: 'root', name: '公開組立手順', status: 'published', isActive: true },
      { id: 'draft', name: '下書き手順', status: 'draft', isActive: true },
      { id: 'draft-head', revisionRootId: 'root-old', name: '改版中', status: 'draft', isActive: true }
    ]);
    mocks.history.mockResolvedValue([{ id: 'old-published', revisionRootId: 'root-old', name: '改版中の旧公開手順', status: 'published', isActive: true, revisionNumber: 2 }]);
    mocks.pdfs.mockResolvedValue([{ id: 'pdf', title: '検査PDF', enabled: true }]);
    mocks.save.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('creates a named blank document and navigates to its editor', async () => {
    mocks.blank.mockResolvedValue({ id: 'new-document' });
    render(<MemoryRouter><Routes><Route path="/" element={<ProcedureManualBrowser />} /><Route path="/kiosk/assembly/procedure-documents/:id/edit" element={<p>新規エディタ</p>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '白紙から作る' }));
    expect(screen.getByRole('button', { name: '作成' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('要領書名'), { target: { value: '  新規要領書  ' } });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    expect(await screen.findByText('新規エディタ')).toBeInTheDocument();
    expect(mocks.blank).toHaveBeenCalledExactlyOnceWith('新規要領書');
  });

  it('shows model search, then processes, then the assigned sequence and missing-publication notice', async () => {
    mocks.detail.mockResolvedValue({
      ...emptyDetail,
      assignments: [{ id: 'missing', modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', sortOrder: 1, label: '検査資料', unavailableReason: 'no_published_revision', resolvedDocumentId: null }],
      sequence: { ...emptyDetail.sequence, documents: [{ orderItemId: 'one', title: '表示手順' }] }
    });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'DFD1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '組立工程 > 組立工程' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'ｄｆｄ１' } });
    expect(screen.queryByRole('button', { name: 'DFD2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'DFD1' }));
    fireEvent.click(await screen.findByRole('button', { name: '組立工程 > 組立工程' }));
    expect(await screen.findByTestId('sequence-viewer')).toHaveTextContent('表示手順');
    expect(screen.getByText('検査資料: 公開版なし')).toBeInTheDocument();
    expect(mocks.detail).toHaveBeenCalledWith('DFD1', 'assembly');
  });

  it('shows an empty model list and keeps the creation entry available', async () => {
    mocks.models.mockResolvedValue([]);
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(await screen.findByText('機種がありません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '割り当てを編集' })).toBeEnabled();
  });

  it('selects published images and PDFs, reorders them, and saves normalized model and root references', async () => {
    const saved = vi.fn();
    render(<ProcedureManualAssignmentDialog modelCode="ｄｆｄ１" processId="assembly" processes={processes} onClose={vi.fn()} onSaved={saved} />);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '追加' })).toBeDisabled());
    await screen.findByRole('option', { name: '公開組立手順' });
    expect(screen.queryByRole('option', { name: '下書き手順' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '改版中の旧公開手順' })).toHaveValue('assembly:root-old');
    await waitFor(() => expect(screen.getByLabelText('文書')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('文書'), { target: { value: 'assembly:root' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.change(screen.getByLabelText('文書'), { target: { value: 'pdf:pdf' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.click(screen.getByRole('button', { name: '上へ 2' }));
    fireEvent.change(screen.getByLabelText('表示名 1'), { target: { value: '検査' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('DFD1', 'assembly', {
      modelCode: 'ｄｆｄ１', assignments: [
        { kioskDocumentId: 'pdf', assemblyProcedureDocumentId: null, sortOrder: 0, label: '検査' },
        { kioskDocumentId: null, assemblyProcedureDocumentId: 'root', sortOrder: 1, label: null }
      ]
    }));
    expect(saved).toHaveBeenCalledWith('DFD1', 'assembly');
  });

  it('keeps the dialog open and displays a permission message after a 403 save', async () => {
    mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    const saved = vi.fn();
    render(<ProcedureManualAssignmentDialog modelCode="DFD1" processId="assembly" processes={processes} onClose={vi.fn()} onSaved={saved} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません');
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
