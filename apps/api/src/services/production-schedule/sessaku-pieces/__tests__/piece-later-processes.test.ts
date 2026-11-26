import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { readWinnerRowsByLogicalKeyFseibans, readRowDetails } from '../../grinding-planning-board/source.js';
import { readLaterProcesses } from '../piece-later-processes.js';
import { sessakuPieceKeyFromRow } from '../piece-key.js';

vi.mock('../../grinding-planning-board/source.js', () => ({
  readWinnerRowsByLogicalKeyFseibans: vi.fn(), readRowDetails: vi.fn()
}));

describe('later piece discovery', () => {
  it('skips the raw grinding resource and still discovers later cutting of the same order', async () => {
    const row = { FSEIBAN: 'S', FHINCD: 'P', FSIGENCD: '021', FKOJUN: '10', ProductNo: '123' };
    const laterGrinding = { ...row, FSIGENCD: '\t581\u3000', FKOJUN: '20' };
    const laterCutting = { ...row, FSIGENCD: '022', FKOJUN: '30' };
    const rows = [row, laterGrinding, laterCutting, { ...laterCutting, ProductNo: '124' }]
      .map((rowData, index) => ({ id: String(index), rowData, updatedAt: new Date(0) }));
    vi.mocked(readWinnerRowsByLogicalKeyFseibans).mockResolvedValue(rows);
    vi.mocked(readRowDetails).mockResolvedValue(new Map());
    const tx = { productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as Prisma.TransactionClient;
    await expect(readLaterProcesses(tx, sessakuPieceKeyFromRow(row), null, true)).resolves.toMatchObject([
      { key: sessakuPieceKeyFromRow(laterCutting), rowId: '2', set: null }
    ]);
  });
});
