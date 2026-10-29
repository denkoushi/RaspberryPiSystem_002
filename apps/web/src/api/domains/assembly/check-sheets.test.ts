import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../http';

import { importAssemblyCheckSheet, listAssemblyCheckSheetRevisions, saveAssemblyCheckSheetRevision } from './check-sheets';

import type { AssemblyCheckSheetSavePayload } from '@raspi-system/shared-types';

vi.mock('../../http', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe('check sheet API client', () => {
  beforeEach(() => vi.resetAllMocks());

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
