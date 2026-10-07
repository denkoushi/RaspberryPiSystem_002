import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TagDeskService } from '../tag-desk.service.js';
import { EmployeeService } from '../../tools/employee.service.js';

const db = vi.hoisted(() => ({
  employee: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  knowledgePositionRank: { findMany: vi.fn() },
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
    db.knowledgePositionRank.findMany.mockResolvedValue([]);
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
      genres,
      positions: []
    });
  });

  it('returns empty organization options when no records exist', async () => {
    expect(await service.listOptions()).toEqual({ divisions: [], sections: [], departments: [], genres: [], positions: [] });
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

  it('classifies employee positions using the mapping even with knowledge disabled', async () => {
    vi.stubEnv('HERMES_KNOWLEDGE_ENABLED', 'false');
    try {
      db.knowledgePositionRank.findMany.mockResolvedValue([
        { positionName: '一般', rank: 'general' }, { positionName: '班長', rank: 'leader' },
        { positionName: '課長', rank: 'section_chief' }, { positionName: '部長', rank: 'manager' }
      ]);
      const positions = ['一般', '班長', '課長', '部長', '主事', null];
      db.employee.findMany.mockResolvedValue(positions.map((positionName, index) => ({
        id: `employee-${index}`, employeeCode: `000${index}`, displayName: '山田 太郎',
        department: null, section: null, status: 'ACTIVE', nfcTagUid: null, positionName
      })));
      const rows = await service.listRegistry('employee');
      expect(rows.map((row) => row.positionName)).toEqual(positions);
      expect(rows.map((row) => row.positionApproval)).toEqual(['none', 'approver', 'approver', 'approver', 'unmapped', null]);
      expect(rows.map((row) => row.record.positionName)).toEqual(['一般', '班長', '課長', '部長', '主事', '']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('unions mapped and employee positions, sorted by name without duplicates or unset entries', async () => {
    db.knowledgePositionRank.findMany.mockResolvedValue([
      { positionName: '一般', rank: 'general' }, { positionName: '班長', rank: 'leader' }, { positionName: '部長', rank: 'manager' }
    ]);
    db.employee.findMany.mockResolvedValue(['班長', '主事', '主事', null, ''].map((positionName) => ({ department: null, section: null, positionName })));
    expect((await service.listOptions()).positions).toEqual([
      { name: '一般', approval: 'none' }, { name: '班長', approval: 'approver' },
      { name: '部長', approval: 'approver' }, { name: '主事', approval: 'unmapped' }
    ].sort((a, b) => a.name.localeCompare(b.name, 'ja')));
  });

  it('saves an employee position on creation', async () => {
    await new EmployeeService().create({ employeeCode: '0001', lastName: '山田', firstName: '太郎', positionName: '班長' });
    expect(db.employee.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ positionName: '班長' }) }));
  });

  it.each(['課長', null, undefined])('updates only an explicitly supplied employee position (%s)', async (positionName) => {
    db.employee.findUnique.mockResolvedValue({ id: 'employee-1', positionName: '班長' });
    await new EmployeeService().update('employee-1', positionName === undefined ? { status: 'INACTIVE' } : { positionName });
    const data = db.employee.update.mock.calls[0][0].data;
    if (positionName === undefined) expect(data).not.toHaveProperty('positionName');
    else expect(data.positionName).toBe(positionName);
  });
});
