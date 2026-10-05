import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TagDeskService } from '../tag-desk.service.js';

const db = vi.hoisted(() => ({
  employee: { findMany: vi.fn(), findUnique: vi.fn() },
  item: { findUnique: vi.fn() },
  measuringInstrument: { findMany: vi.fn() },
  measuringInstrumentGenre: { findMany: vi.fn() },
  riggingGear: { findMany: vi.fn() },
  measuringInstrumentTag: { findUnique: vi.fn() },
  riggingGearTag: { findUnique: vi.fn() },
  inventoryNfcTag: { findUnique: vi.fn() },
  loan: { findMany: vi.fn(), count: vi.fn() }
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: db }));

describe('TagDeskService organization fields', () => {
  const service = new TagDeskService();

  beforeEach(() => {
    vi.resetAllMocks();
    db.employee.findMany.mockResolvedValue([]);
    db.measuringInstrument.findMany.mockResolvedValue([]);
    db.riggingGear.findMany.mockResolvedValue([]);
    db.measuringInstrumentGenre.findMany.mockResolvedValue([]);
  });

  it('separates divisions and section pairs and combines asset departments after trimming and deduplication', async () => {
    db.employee.findMany.mockResolvedValue([
      { department: ' 製造部 ', section: ' 機械課 ' },
      { department: '製造部', section: '機械課' },
      { department: '製造部', section: '資材課' },
      { department: '管理部', section: '資材課' },
      { department: '技術部', section: null },
      { department: '三島工場', section: '  ' },
      { department: null, section: '部門未設定課' },
      { department: '  ', section: '' }
    ]);
    db.measuringInstrument.findMany.mockResolvedValue([{ department: ' 製造担当 ' }, { department: '機械課' }, { department: '' }, { department: ' ' }, { department: null }]);
    db.riggingGear.findMany.mockResolvedValue([{ department: ' 製造課 ' }, { department: '機械課' }, { department: ' ' }]);
    const genres = [{ id: 'genre-1', name: 'ゲージ' }];
    db.measuringInstrumentGenre.findMany.mockResolvedValue(genres);
    const result = await service.listOptions();
    expect(result).toEqual({
      divisions: ['製造部', '管理部', '技術部', '三島工場'].sort((a, b) => a.localeCompare(b, 'ja')),
      sections: [
        { division: '製造部', name: '機械課' },
        { division: '製造部', name: '資材課' },
        { division: '管理部', name: '資材課' }
      ].sort((a, b) => a.division.localeCompare(b.division, 'ja') || a.name.localeCompare(b.name, 'ja')),
      departments: ['機械課', '資材課', '部門未設定課', '製造担当', '製造課'].sort((a, b) => a.localeCompare(b, 'ja')),
      genres
    });
  });

  it('returns empty organization options when no records exist', async () => {
    expect(await service.listOptions()).toEqual({ divisions: [], sections: [], departments: [], genres: [] });
  });

  it.each(['機械課', null, ''])('includes section %s in employee rows and tag bindings, with null for no section', async (section) => {
    const employee = {
      id: 'employee-1', employeeCode: '0001', displayName: '山田 太郎', lastName: '山田', firstName: '太郎',
      department: '製造部', section, status: 'ACTIVE', nfcTagUid: 'TAG-1'
    };
    db.employee.findMany.mockResolvedValue([employee]);
    db.employee.findUnique.mockResolvedValue(employee);
    db.loan.findMany.mockResolvedValue([]);
    db.loan.count.mockResolvedValue(0);
    expect(await service.listRegistry('employee')).toMatchObject([{ sub: '製造部', sub2: section || null, record: { department: '製造部', section: section ?? '' } }]);
    expect(await service.resolve('TAG-1')).toMatchObject([{ kind: 'employee', sub: '製造部', sub2: section || null }]);
  });
});
