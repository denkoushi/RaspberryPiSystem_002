import { describe, expect, it } from 'vitest';

import {
  DGX_PRIMARY_TASK_SCENARIO_ORDER,
  orderPrimaryScenarioActions,
} from './dgxResourceTaskFlows';

import type { DgxOperatorConsoleActionApi } from '../../../api/dgx-resource.types';

describe('dgxResourceTaskFlows', () => {
  it('orders scenario actions stable with shuffled inputs', () => {
    const shuffled: DgxOperatorConsoleActionApi[] = [
      {
        id: 'experiment_to_business',
        labelJa: 'e',
        subtitleJa: 'e',
        scenarioId: 'experiment_to_business',
        primary: false,
      },
      {
        id: 'business_to_private',
        labelJa: 'a',
        subtitleJa: 'a',
        scenarioId: 'business_to_private',
        primary: true,
      },
      {
        id: 'private_to_business',
        labelJa: 'b',
        subtitleJa: 'b',
        scenarioId: 'private_to_business',
        primary: false,
      },
      {
        id: 'business_to_experiment',
        labelJa: 'c',
        subtitleJa: 'c',
        scenarioId: 'business_to_experiment',
        primary: false,
      },
    ];

    expect(orderPrimaryScenarioActions(shuffled).map((a) => a.scenarioId)).toEqual([
      ...DGX_PRIMARY_TASK_SCENARIO_ORDER,
    ]);
  });
});
