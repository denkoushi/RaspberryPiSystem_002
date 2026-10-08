import { describe, expect, it, vi } from 'vitest';

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: queryRaw } }));
import { loadProcedureMaterialRecords, procedureMaterialRows } from '../procedure-material-hermes-source.service.js';

const row = (id: string, extra = {}) => ({ id, gmailMessageId: 'm1', kind: 'TEXT' as const,
  subjectHint: '組立', text: '本文', originalFileName: null, discardedAt: null,
  fromEmail: 'private@example.test', ...extra });

describe('procedure material corpus', () => {
  it('groups mail rows, deduplicates hints and includes only TEXT bodies and filenames', () => {
    const records = procedureMaterialRows([
      row('1'), row('2', { kind: 'PHOTO', text: '写真の非本文', originalFileName: 'image001.jpg' }),
      row('3', { subjectHint: '修理', kind: 'PDF', text: null, originalFileName: 'manual.pdf' }),
      row('4', { gmailMessageId: null }), row('5', { gmailMessageId: null }),
      row('6', { discardedAt: new Date(), subjectHint: '捨てたヒント', text: '捨てた本文' }),
    ] as Parameters<typeof procedureMaterialRows>[0]);
    expect(records).toEqual([
      { kind: 'procedure_material', id: 'mail:m1', bodyText: '組立\n修理\n本文\nimage001.jpg\nmanual.pdf' },
      { kind: 'procedure_material', id: 'material:4', bodyText: '組立\n本文' },
      { kind: 'procedure_material', id: 'material:5', bodyText: '組立\n本文' },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/private|fromEmail|捨てた|写真の非本文/);
  });

  it('drops empty and whitespace-only records but indexes filenames alone', () => {
    expect(procedureMaterialRows([
      row('1', { subjectHint: ' ', text: '\n' }),
      row('2', { gmailMessageId: null, subjectHint: null, text: null }),
      row('3', { gmailMessageId: null, subjectHint: null, text: null, originalFileName: 'image.jpg' }),
    ])).toEqual([{ kind: 'procedure_material', id: 'material:3', bodyText: 'image.jpg' }]);
  });

  it('bounds the newest live rows and reads only a bounded TEXT body in SQL', async () => {
    const materials = Array.from({ length: 20001 }, (_, i) => row(String(i), { gmailMessageId: null }));
    queryRaw.mockImplementation(async (_sql, bodyLimit, rowLimit) => {
      expect(bodyLimit).toBe(4000); expect(rowLimit).toBe(20000);
      return materials.slice(0, rowLimit);
    });
    const records = await loadProcedureMaterialRecords();
    expect(records).toHaveLength(20000);
    expect(records.at(-1)?.id).toBe('material:19999');
    const sql = queryRaw.mock.calls[0][0].join('?');
    expect(sql).toContain(`CASE WHEN "kind" = 'TEXT' THEN LEFT("text", ?) ELSE NULL END AS "text"`);
    expect(sql).toContain('WHERE "discardedAt" IS NULL');
    expect(sql).toContain('ORDER BY "receivedAt" DESC, "createdAt" DESC, "id" DESC LIMIT ?');
    expect(sql).not.toContain('fromEmail');
    queryRaw.mockResolvedValue([row('1', { text: '変更した本文' })]);
    expect((await loadProcedureMaterialRecords())[0]).toEqual({ kind: 'procedure_material', id: 'mail:m1', bodyText: '組立\n変更した本文' });
  });

  it('truncates the combined mail body including hints, TEXT bodies and filenames', () => {
    const records = procedureMaterialRows([
      row('1', { subjectHint: 'あ'.repeat(3000), text: 'い'.repeat(3000) }),
      row('2', { kind: 'PDF', subjectHint: null, text: '非本文', originalFileName: 'う'.repeat(3000) }),
      row('3', { gmailMessageId: null, subjectHint: null, text: null, originalFileName: 'え'.repeat(5000) }),
    ] as Parameters<typeof procedureMaterialRows>[0]);
    expect(records.map(record => record.bodyText.length)).toEqual([4000, 4000]);
    expect(records[0].bodyText).toBe('あ'.repeat(3000) + '\n' + 'い'.repeat(999));
    expect(records[1].bodyText).toBe('え'.repeat(4000));
  });
});
