import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { ensureProcedureManualProcesses } from '../procedure-manual-reference-data.js';

describe('procedure-manual reference data', () => {
  let rows: Prisma.ProcedureManualProcessCreateManyInput[];

  beforeEach(() => {
    rows = [];
    vi.spyOn(prisma.procedureManualProcess, 'createMany').mockImplementation(async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const row of Array.isArray(data) ? data : [data]) {
        if (rows.some(existing => existing.id === row.id)) {
          if (skipDuplicates) continue;
          throw new Error('Duplicate process ID');
        }
        if (row.parentId && !rows.some(existing => existing.id === row.parentId)) {
          throw new Error('Missing parent process');
        }
        rows.push({ ...row });
        count++;
      }
      return { count };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('adds the three machining rows to an empty database, parent first', async () => {
    await ensureProcedureManualProcesses(prisma);
    expect(rows).toEqual([
      { id: 'procedure-manual-machining', parentId: null, name: '加工', sortOrder: 2 },
      { id: 'procedure-manual-machining-cutting', parentId: 'procedure-manual-machining', name: '切削', sortOrder: 0, subjectKind: 'PART' },
      { id: 'procedure-manual-machining-grinding', parentId: 'procedure-manual-machining', name: '研削', sortOrder: 1, subjectKind: 'PART' },
    ]);
  });

  it('does not add duplicate rows when run again', async () => {
    await ensureProcedureManualProcesses(prisma);
    const initial = rows.map(row => ({ ...row }));
    await ensureProcedureManualProcesses(prisma);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(initial);
  });

  it('preserves existing names and sort orders while adding missing rows', async () => {
    const existing = [
      { id: 'procedure-manual-machining', parentId: null, name: '加工（編集済み）', sortOrder: 20 },
      { id: 'procedure-manual-machining-cutting', parentId: 'procedure-manual-machining', name: '切削（編集済み）', sortOrder: 10 },
      { id: 'custom-process', parentId: null, name: '独自工程', sortOrder: 30 },
    ];
    rows.push(...existing.map(row => ({ ...row })));
    await ensureProcedureManualProcesses(prisma);
    expect(rows).toEqual([
      ...existing,
      { id: 'procedure-manual-machining-grinding', parentId: 'procedure-manual-machining', name: '研削', sortOrder: 1, subjectKind: 'PART' },
    ]);
  });
});
