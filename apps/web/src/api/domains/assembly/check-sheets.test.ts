import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../http';

import { changeAssemblyCheckSheetRevision, getAssemblyCheckSheetPaperLayout, importAssemblyCheckSheet, listAssemblyCheckSheetRevisions, saveAssemblyCheckSheetRevision, transitionAssemblyCheckSheet } from './check-sheets';

import type { AssemblyCheckSheetSavePayload } from '@raspi-system/shared-types';

vi.mock('../../http', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('check sheet API client', () => {
  beforeEach(() => vi.resetAllMocks());

  it('changes the revision through the authenticated client and returns the sheet', async () => {
    const data = { id: 'sheet', revisionId: 'new-revision' };
    vi.mocked(api.put).mockResolvedValue({ data });
    expect(await changeAssemblyCheckSheetRevision('sheet', 'root')).toEqual(data);
    expect(api.put).toHaveBeenCalledWith('/assembly/check-sheets/sheet/revision', { revisionRootId: 'root' });
  });

  it('fetches the paper layout through the authenticated client', async () => {
    const data = { layoutSnapshot: {}, writes: [], stampCells: [] };
    vi.mocked(api.get).mockResolvedValue({ data });
    expect(await getAssemblyCheckSheetPaperLayout('sheet')).toEqual(data);
    expect(api.get).toHaveBeenCalledWith('/assembly/check-sheets/sheet/paper-layout');
  });

  it('requests the revision heads without a history root filter', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    expect(await listAssemblyCheckSheetRevisions()).toEqual([]);
    expect(api.get).toHaveBeenCalledWith('/assembly/check-sheets/revisions');
  });

  it('uploads the selected xlsx as multipart without overriding the browser boundary', async () => {
    const file = new File(['synthetic'], 'sheet.xlsx');
    vi.mocked(api.post).mockResolvedValue({ data: { importId: 'uploaded' } });
    expect(await importAssemblyCheckSheet(file)).toEqual({ importId: 'uploaded' });
    expect(api.post).toHaveBeenCalledWith('/assembly/check-sheets/imports', expect.any(FormData));
    const form = vi.mocked(api.post).mock.calls[0][1] as FormData;
    expect(form.get('file')).toBe(file);
    expect(Array.from(form.keys())).toEqual(['file']);
  });

  it.each(['pause', 'resume', 'complete'] as const)('sends the scanned tag for %s', async (action) => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'sheet' } });
    await transitionAssemblyCheckSheet('sheet', action, 'worker-tag');
    expect(api.post).toHaveBeenCalledWith(`/assembly/check-sheets/sheet/${action}`, { nfcTagUid: 'worker-tag' });
  });

  it('passes the edited payload through and returns the saved revision', async () => {
    const payload: AssemblyCheckSheetSavePayload = {
      importId: '11111111-1111-4111-8111-111111111111',
      proposal: {
        documentNo: '', title: '検査', modelCode: '', revisionLabel: '', sourceSheetName: '検査',
        headerCellMap: {}, stampColumn: 'S', departmentRoleMembers: {}, groups: [], items: []
      }
    };
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'saved' } });
    expect(await saveAssemblyCheckSheetRevision(payload)).toEqual({ id: 'saved' });
    expect(api.post).toHaveBeenCalledWith('/assembly/check-sheets/revisions', payload);
  });
});
