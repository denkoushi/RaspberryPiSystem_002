import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createDecisionEvent } = vi.hoisted(() => ({
  createDecisionEvent: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    dueManagementProposalEvent: {
      create: vi.fn(),
    },
    dueManagementOperatorDecisionEvent: {
      create: createDecisionEvent,
    },
    dueManagementOutcomeEvent: {
      create: vi.fn(),
    },
  },
}));

import { dueManagementLearningEventRepository } from '../due-management-learning-event.repository.js';

describe('due-management-learning-event.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有効な reasonCode を decision event に保存する', async () => {
    await dueManagementLearningEventRepository.saveDecisionEvent({
      locationKey: 'shared-global-rank',
      sourceType: 'manual',
      reasonCode: 'BOTTLENECK_AVOIDANCE',
      orderedFseibans: ['A'],
      previousOrderedFseibans: ['A'],
      proposalOrderedFseibans: ['A'],
      reorderDeltaRatio: null,
      metadata: {},
    });

    expect(createDecisionEvent).toHaveBeenCalledTimes(1);
    const payload = createDecisionEvent.mock.calls[0][0] as {
      data: { reasonCode?: string | null };
    };
    expect(payload.data.reasonCode).toBe('BOTTLENECK_AVOIDANCE');
  });

  it('無効な reasonCode は null で保存する', async () => {
    await dueManagementLearningEventRepository.saveDecisionEvent({
      locationKey: 'shared-global-rank',
      sourceType: 'manual',
      reasonCode: 'INVALID_REASON',
      orderedFseibans: ['A'],
      previousOrderedFseibans: ['A'],
      proposalOrderedFseibans: ['A'],
      reorderDeltaRatio: null,
      metadata: {},
    });

    const payload = createDecisionEvent.mock.calls[0][0] as {
      data: { reasonCode?: string | null };
    };
    expect(payload.data.reasonCode).toBeNull();
  });
});
