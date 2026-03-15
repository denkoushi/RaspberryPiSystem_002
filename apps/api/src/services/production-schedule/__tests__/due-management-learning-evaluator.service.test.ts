import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    dueManagementProposalEvent: {
      findMany: vi.fn()
    },
    dueManagementOperatorDecisionEvent: {
      findMany: vi.fn()
    },
    dueManagementOutcomeEvent: {
      findMany: vi.fn()
    }
  }
}));

vi.mock('../due-management-location-scope-adapter.service.js', () => ({
  listDueManagementSummariesWithScope: vi.fn(),
  toDueManagementScope: vi.fn((scope) => scope),
  resolveDueManagementStorageLocationKey: vi.fn((scope) => scope?.deviceScopeKey ?? 'default')
}));

vi.mock('../seiban-progress.service.js', () => ({
  fetchSeibanProgressRows: vi.fn()
}));

import { prisma } from '../../../lib/prisma.js';
import { evaluateDueManagementLearningReport } from '../due-management-learning-evaluator.service.js';
import { listDueManagementSummariesWithScope } from '../due-management-location-scope-adapter.service.js';
import { fetchSeibanProgressRows } from '../seiban-progress.service.js';

describe('due-management-learning-evaluator.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('イベント集計と遅延指標を返す', async () => {
    vi.mocked(prisma.dueManagementProposalEvent.findMany).mockResolvedValue([{ id: 'p1' }] as never);
    vi.mocked(prisma.dueManagementOperatorDecisionEvent.findMany).mockResolvedValue([
      {
        payload: {
          rankMetrics: {
            topKPrecision: 0.5,
            spearmanRho: 0.3,
            kendallTau: 0.1
          }
        }
      },
      {
        payload: {
          rankMetrics: {
            topKPrecision: 1,
            spearmanRho: 0.7,
            kendallTau: 0.5
          }
        }
      }
    ] as never);
    vi.mocked(prisma.dueManagementOutcomeEvent.findMany).mockResolvedValue([{ id: 'o1' }, { id: 'o2' }] as never);
    vi.mocked(listDueManagementSummariesWithScope).mockResolvedValue([
      {
        fseiban: 'A',
        machineName: null,
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
        partsCount: 2,
        processCount: 3,
        totalRequiredMinutes: 120
      },
      {
        fseiban: 'B',
        machineName: null,
        dueDate: new Date('2999-01-01T00:00:00.000Z'),
        partsCount: 1,
        processCount: 1,
        totalRequiredMinutes: 10
      }
    ]);
    vi.mocked(fetchSeibanProgressRows).mockResolvedValue([
      { fseiban: 'A', total: 3, completed: 1, incompleteProductNames: [], machineName: null },
      { fseiban: 'B', total: 1, completed: 1, incompleteProductNames: [], machineName: null }
    ]);

    const report = await evaluateDueManagementLearningReport({
      locationScope: { deviceScopeKey: 'Test' }
    });

    expect(report.locationKey).toBe('Test');
    expect(report.summary.proposalCount).toBe(1);
    expect(report.summary.decisionCount).toBe(2);
    expect(report.summary.outcomeCount).toBe(2);
    expect(report.summary.overdueSeibanCount).toBe(1);
    expect(report.summary.overdueTotalDays).toBeGreaterThan(0);
    expect(report.summary.avgTopKPrecision).toBe(0.75);
    expect(report.summary.avgSpearmanRho).toBe(0.5);
    expect(report.summary.avgKendallTau).toBe(0.3);
    expect(report.recommendation.primaryObjective).toBe('minimize_due_delay');
  });
});
