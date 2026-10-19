import { describe, expect, it, vi } from 'vitest';

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: queryRaw } }));
import { loadProcedureMaterialRecords, procedureMaterialRows } from '../procedure-material-hermes-source.service.js';

const row = (id: string, extra = {}) => ({ id, gmailMessageId: 'm1', kind: 'TEXT' as const,
  subjectHint: '組立', text: '本文', originalFileName: null, discardedAt: null,
  fromEmail: 'private@example.test', imageDescription: null, ...extra });

describe('procedure material corpus', () => {
  it('indexes each material with its own subject, filename and text of any kind', () => {
    const records = procedureMaterialRows([
      row('1'), row('2', { kind: 'PHOTO', text: '写真の文字', imageDescription: '赤い工具、銘板 AB12', originalFileName: 'image001.jpg' }),
      row('3', { subjectHint: '修理', kind: 'PDF', text: 'PDFの文字', originalFileName: 'manual.pdf' }),
      row('4', { gmailMessageId: null }), row('5', { gmailMessageId: null }),
      row('6', { discardedAt: new Date(), subjectHint: '捨てたヒント', text: '捨てた本文' }),
    ] as Parameters<typeof procedureMaterialRows>[0]);
    expect(records).toEqual([
      { kind: 'procedure_material', id: 'material:1', bodyText: '組立\n本文' },
      { kind: 'procedure_material', id: 'material:2', bodyText: '組立\nimage001.jpg\n写真の文字\n赤い工具、銘板 AB12' },
      { kind: 'procedure_material', id: 'material:3', bodyText: '修理\nmanual.pdf\nPDFの文字' },
      { kind: 'procedure_material', id: 'material:4', bodyText: '組立\n本文' },
      { kind: 'procedure_material', id: 'material:5', bodyText: '組立\n本文' },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/private|fromEmail|捨てた/);
  });

  it('drops empty and whitespace-only records but indexes filenames alone', () => {
    expect(procedureMaterialRows([
      row('1', { subjectHint: ' ', text: '\n' }),
      row('2', { gmailMessageId: null, subjectHint: null, text: null }),
      row('3', { gmailMessageId: null, subjectHint: null, text: null, originalFileName: 'image.jpg' }),
    ])).toEqual([{ kind: 'procedure_material', id: 'material:3', bodyText: 'image.jpg' }]);
  });

  it('bounds the newest live rows and reads only a bounded body for every kind in SQL', async () => {
    const materials = Array.from({ length: 20001 }, (_, i) => row(String(i), { gmailMessageId: null }));
    queryRaw.mockImplementation(async (_sql, bodyLimit, descriptionLimit, rowLimit) => {
      expect(bodyLimit).toBe(4000); expect(descriptionLimit).toBe(4000); expect(rowLimit).toBe(20000);
      return materials.slice(0, rowLimit);
    });
    const records = await loadProcedureMaterialRecords();
    expect(records).toHaveLength(20000);
    expect(records.at(-1)?.id).toBe('material:19999');
    const sql = queryRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('LEFT("text", ?::int) AS "text"');
    expect(sql).not.toContain('CASE WHEN');
    expect(sql).toContain('LEFT("imageDescription", ?::int) AS "imageDescription"');
    expect(sql).toContain('WHERE "discardedAt" IS NULL');
    expect(sql).toContain('ORDER BY "receivedAt" DESC, "createdAt" DESC, "id" DESC LIMIT ?');
    expect(sql).not.toContain('fromEmail');
    queryRaw.mockResolvedValue([row('1', { text: '変更した本文', imageDescription: '新しい説明' })]);
    expect((await loadProcedureMaterialRecords())[0]).toEqual({ kind: 'procedure_material', id: 'material:1', bodyText: '組立\n変更した本文\n新しい説明' });
  });

  it('reserves space for image descriptions after long PDF page text', () => {
    const [record] = procedureMaterialRows([row('page', { text: 'あ'.repeat(5000), imageDescription: '銘板 AB12' })] as Parameters<typeof procedureMaterialRows>[0]);
    expect(record.bodyText).toHaveLength(4000);
    expect(record.bodyText.endsWith('\n銘板 AB12')).toBe(true);
  });

  it('caps each material body at 4000 characters and keeps its filename before long text', () => {
    const records = procedureMaterialRows([
      row('1', { originalFileName: 'manual.pdf', text: 'あ'.repeat(5000) }),
      row('2', { kind: 'PHOTO', subjectHint: null, originalFileName: 'page.png', text: 'い'.repeat(5000) }),
      row('3', { gmailMessageId: null, subjectHint: null, text: null, originalFileName: 'え'.repeat(5000) }),
    ] as Parameters<typeof procedureMaterialRows>[0]);
    expect(records.map(record => record.bodyText.length)).toEqual([4000, 4000, 4000]);
    expect(records[0].bodyText).toBe(('組立\nmanual.pdf\n' + 'あ'.repeat(5000)).slice(0, 4000));
    expect(records[1].bodyText).toBe(('page.png\n' + 'い'.repeat(5000)).slice(0, 4000));
    expect(records[2].bodyText).toBe('え'.repeat(4000));
  });
});
