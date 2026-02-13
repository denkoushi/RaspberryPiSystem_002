import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { fetchSeibanProgressRows } from '../seiban-progress.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe('seiban-progress.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fseiban が空なら DB クエリせず空配列を返す', async () => {
    const result = await fetchSeibanProgressRows([]);

    expect(result).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('fseiban を正規化して進捗行を返す', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'S-001', total: 2, completed: 1, incompleteProductNames: ['A'] },
    ] as never);

    const result = await fetchSeibanProgressRows(['S-001', ' S-001 ', '', 'S-002']);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { fseiban: 'S-001', total: 2, completed: 1, incompleteProductNames: ['A'] },
    ]);
  });
});
