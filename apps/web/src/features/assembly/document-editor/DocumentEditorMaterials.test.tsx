import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorPartsPane } from './AssemblyProcedureDocumentEditorPartsPane';
import { DocumentEditorMaterials } from './DocumentEditorMaterials';

import type { ProcedureMaterialDto } from '../procedure-manuals/procedure-material-types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), byTag: vi.fn(), nfc: null as { uid: string; timestamp: string } | null, enabled: vi.fn(), thumbnail: vi.fn(async () => new Blob()) }));
vi.mock('../../../api/client', () => ({ listProcedureMaterialsByEmployeeTag: mocks.byTag, listProcedureMaterials: mocks.list, getProcedureMaterialThumbnail: mocks.thumbnail }));
vi.mock('../../../hooks/useNfcStream', () => ({ useNfcStream: (enabled: boolean) => { mocks.enabled(enabled); return mocks.nfc; } }));
const material = { id: 'text', kind: 'TEXT', text: '未配置の文章', placedAt: null, discardedAt: null, documentId: null } as ProcedureMaterialDto;
beforeEach(() => { vi.clearAllMocks(); mocks.nfc = null; mocks.list.mockResolvedValue([material]); });
describe('DocumentEditorMaterials', () => {
  it('loads only the normal unplaced shelf and excludes PDF, placed and discarded materials', async () => {
    mocks.list.mockResolvedValue([material, { ...material, id: 'pdf', kind: 'PDF' }, { ...material, id: 'placed', placedAt: 'now' }, { ...material, id: 'discarded', discardedAt: 'now' }]);
    const drag = { onClick: vi.fn(), onPointerDown: vi.fn() };
    const view = render(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    const card = await screen.findByRole('button', { name: '素材を置く: 未配置の文章' });
    expect(card.style.touchAction).toBe('pan-y');
    expect(card.style.userSelect).toBe('none');
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ state: 'unplaced', limit: 500 });
    fireEvent.click(card);
    expect(drag.onClick).toHaveBeenCalledExactlyOnceWith(material);
    view.rerender(<DocumentEditorMaterials revision={1} disabled drag={drag} />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(card).toBeDisabled();
  });
  it('reports list failures near the material cards', async () => {
    mocks.list.mockRejectedValue(new Error('offline'));
    render(<DocumentEditorMaterials revision={0} disabled={false} drag={{ onClick: vi.fn(), onPointerDown: vi.fn() }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('素材を取得できませんでした。');
  });
  it('opens the tag gate, ignores old events, lists employee cards and closes back to the shelf', async () => {
    const employeeMaterial = { ...material, id: 'employee', text: '社員の素材' };
    mocks.byTag.mockResolvedValue({ employee: { employeeCode: '7125', displayName: '津田' }, materials: [employeeMaterial] });
    const drag = { onClick: vi.fn(), onPointerDown: vi.fn() };
    mocks.nfc = { uid: 'old', timestamp: new Date(Date.now() - 10000).toISOString() };
    const view = render(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    fireEvent.click(screen.getByRole('button', { name: '社員番号' }));
    expect(screen.getByText('社員タグ')).toBeInTheDocument();
    expect(mocks.enabled).toHaveBeenLastCalledWith(true);
    expect(mocks.byTag).not.toHaveBeenCalled();
    mocks.nfc = { uid: 'mine', timestamp: new Date(Date.now() + 10).toISOString() };
    view.rerender(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    const card = await screen.findByRole('button', { name: '素材を置く: 社員の素材' });
    expect(screen.getByText('7125')).toBeInTheDocument();
    expect(screen.getByText('津田')).toBeInTheDocument();
    expect(mocks.byTag).toHaveBeenCalledExactlyOnceWith('mine');
    fireEvent.pointerDown(card);
    fireEvent.click(card);
    expect(drag.onClick).toHaveBeenCalledWith({ ...employeeMaterial, employeeTagUid: 'mine' });
    expect(drag.onPointerDown).toHaveBeenCalledWith({ ...employeeMaterial, employeeTagUid: 'mine' }, expect.anything());
    expect(mocks.enabled).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: '社員番号' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '素材を置く: 未配置の文章' })).toBeInTheDocument();
  });
  it('shows checking and a red unknown-tag error without processing the event twice', async () => {
    let reject!: (error: unknown) => void;
    mocks.byTag.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const drag = { onClick: vi.fn(), onPointerDown: vi.fn() };
    const view = render(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    fireEvent.click(screen.getByRole('button', { name: '社員番号' }));
    mocks.nfc = { uid: 'unknown', timestamp: new Date(Date.now() + 10).toISOString() };
    view.rerender(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    expect(screen.getByRole('status')).toHaveTextContent('確認中…');
    reject({ response: { status: 404 } });
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('登録されていないタグです');
    expect(error).toHaveClass('text-[#e5484d]');
    view.rerender(<DocumentEditorMaterials revision={1} disabled={false} drag={drag} />);
    expect(screen.getByRole('alert')).toHaveTextContent('登録されていないタグです');
    expect(screen.getByRole('alert')).toHaveClass('text-[#e5484d]');
    expect(mocks.byTag).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByText('社員タグ')).not.toBeInTheDocument();
  });

  it('returns to the normal shelf after switching parts tabs and requires a new scan', async () => {
    mocks.byTag.mockResolvedValue({ employee: { employeeCode: '7125', displayName: '津田' }, materials: [material] });
    render(<AssemblyProcedureDocumentEditorPartsPane elements={[]} pageIndex={0} onDuplicate={vi.fn()} selectedOverlayId={null} hiddenOverlayIds={new Set()} onSelect={vi.fn()} onBringForward={vi.fn()} onSendBackward={vi.fn()} onToggleHidden={vi.fn()} readOnly={false} busy={false}
      materials={<DocumentEditorMaterials revision={0} disabled={false} drag={{ onClick: vi.fn(), onPointerDown: vi.fn() }} />} />);
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    fireEvent.click(screen.getByRole('button', { name: '社員番号' }));
    expect(screen.getByText('社員タグ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ほか 0' }));
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    expect(screen.getByRole('button', { name: '社員番号' })).toBeInTheDocument();
    expect(screen.queryByText('社員タグ')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '社員番号' }));
    expect(screen.getByText('社員タグ')).toBeInTheDocument();
    expect(mocks.byTag).not.toHaveBeenCalled();
  });
  it('ignores a tag response after the gate is closed', async () => {
    let resolve!: (value: unknown) => void;
    mocks.byTag.mockImplementation(() => new Promise(done => { resolve = done; }));
    const drag = { onClick: vi.fn(), onPointerDown: vi.fn() };
    const view = render(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    fireEvent.click(screen.getByRole('button', { name: '社員番号' }));
    mocks.nfc = { uid: 'mine', timestamp: new Date(Date.now() + 10).toISOString() };
    view.rerender(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    resolve({ employee: { employeeCode: '7125', displayName: '津田' }, materials: [{ ...material, text: '社員の素材' }] });
    await waitFor(() => expect(screen.getByRole('button', { name: '素材を置く: 未配置の文章' })).toBeInTheDocument());
    expect(screen.queryByText('津田')).not.toBeInTheDocument();
    expect(screen.queryByText('社員の素材')).not.toBeInTheDocument();
  });

});
