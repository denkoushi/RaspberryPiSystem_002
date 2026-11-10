import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('../row-resolver/index.js', () => ({ buildMaxProductNoWinnerCondition: () => Prisma.sql`TRUE` }));

import { analyzeCompletionHistorySignals } from '../completion-history-analyzer.service.js';

const history = (resourceCd: string, completed: number, total: number, avg: number | null) => ({
  resourceCd,
  completedCount: BigInt(completed),
  totalCount: BigInt(total),
  avgRequiredMinutes: avg
});
const candidate = (fseiban: string, resourceCd: string, avg: number | null) => ({ fseiban, resourceCd, avgRequiredMinutes: avg });

const arrange = (historyRows: unknown[], candidateRows: unknown[]) => {
  mocks.queryRaw.mockResolvedValueOnce(historyRows).mockResolvedValueOnce(candidateRows);
};

describe('analyzeCompletionHistorySignals', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
  });

  it('returns an empty map without querying for blank candidates', async () => {
    const result = await analyzeCompletionHistorySignals({ candidateFseibans: [' ', ''] });
    expect(result.size).toBe(0);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('averages per-resource delay risk, estimation gap and throughput penalty', async () => {
    arrange(
      [history('R1', 8, 10, 100), history('r2 ', 1, 4, 50)],
      [candidate('A', 'R1', 150), candidate('A', ' R2', 50)]
    );
    const result = await analyzeCompletionHistorySignals({ candidateFseibans: ['A'] });
    const a = result.get('A')!;
    // R1: ratio 0.8 -> risk 0.2, gap |150-100|/100 = 0.5, penalty 0
    // R2: ratio 0.25 -> risk 0.75, gap 0, penalty 1
    expect(a.delayRiskScore).toBeCloseTo((0.2 + 0.75) / 2);
    expect(a.estimationGapScore).toBeCloseTo(0.5 / 2);
    expect(a.throughputPenaltyScore).toBeCloseTo(0.5);
  });

  it('caps estimation gap at 2 per resource', async () => {
    arrange([history('R1', 10, 10, 10)], [candidate('A', 'R1', 1000)]);
    const result = await analyzeCompletionHistorySignals({ candidateFseibans: ['A'] });
    expect(result.get('A')).toEqual({ delayRiskScore: 0, estimationGapScore: 2, throughputPenaltyScore: 0 });
  });

  it('uses 0.5 completion ratio and no gap for resources without history', async () => {
    arrange([], [candidate('A', 'UNKNOWN', 80)]);
    const result = await analyzeCompletionHistorySignals({ candidateFseibans: ['A'] });
    // 0.5 < 0.6 -> throughput penalty
    expect(result.get('A')).toEqual({ delayRiskScore: 0.5, estimationGapScore: 0, throughputPenaltyScore: 1 });
  });

  it('applies the 0.6 throughput threshold exclusively', async () => {
    arrange([history('R1', 6, 10, 0), history('R2', 59, 100, 0)], [candidate('A', 'R1', 0), candidate('B', 'R2', 0)]);
    const result = await analyzeCompletionHistorySignals({ candidateFseibans: ['A', 'B'] });
    expect(result.get('A')?.throughputPenaltyScore).toBe(0);
    expect(result.get('B')?.throughputPenaltyScore).toBe(1);
    // baseline 0 -> no gap contribution (avoid divide by zero)
    expect(result.get('A')?.estimationGapScore).toBe(0);
  });

  it('treats zero total history as completion ratio 0 (max risk)', async () => {
    arrange([history('R1', 0, 0, null)], [candidate('A', 'R1', 30)]);
    const result = await analyzeCompletionHistorySignals({ candidateFseibans: ['A'] });
    // history avg null -> baseline 0 -> no gap
    expect(result.get('A')).toEqual({ delayRiskScore: 1, estimationGapScore: 0, throughputPenaltyScore: 1 });
  });

  it('returns empty signals for candidates without unfinished rows and keeps dedup order', async () => {
    arrange([history('R1', 5, 10, 10)], [candidate('B', 'R1', 10)]);
    const result = await analyzeCompletionHistorySignals({ candidateFseibans: ['A', ' B', 'A'] });
    expect(Array.from(result.keys())).toEqual(['A', 'B']);
    expect(result.get('A')).toEqual({ delayRiskScore: 0, estimationGapScore: 0, throughputPenaltyScore: 0 });
    expect(result.get('B')).toEqual({ delayRiskScore: 0.5, estimationGapScore: 0, throughputPenaltyScore: 1 });
  });

  it('sends normalized candidates to the candidate query', async () => {
    arrange([], []);
    await analyzeCompletionHistorySignals({ candidateFseibans: [' A ', 'B', 'A'] });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    const candidateQueryValues = mocks.queryRaw.mock.calls[1].slice(1);
    expect(candidateQueryValues).toContainEqual(expect.objectContaining({ values: ['A', 'B'] }));
  });
});
