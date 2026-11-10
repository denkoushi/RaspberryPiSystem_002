import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { buildForwardPlanningBoardGanttLayout } from '../gantt/planningBoardGanttLayout';

import { productionFixture } from './fixture';

it('preserves complete layouts across production-size rank cycles and explicit lane orders', () => {
  const { items, options } = productionFixture();
  const laneOrder = Object.fromEntries(options.resources.map((resource) => [resource,
    items.filter((item) => item.originalResourceCd === resource).map((item) => item.itemId).reverse()]));
  const variants = {
    resource: options,
    seiban: { ...options, view: 'seiban' as const },
    explicit: { ...options, laneOrder },
    mixed: { ...options, laneOrder: { [options.resources[0]!]: laneOrder[options.resources[0]!]! } },
    incomplete: { ...options, items: items.map((item, i) => ({ ...item, isCompleted: i % 19 === 0,
      requiredMinutesKnown: i % 23 !== 0, alternateRank: items.length - i })) }
  };
  const digests = Object.fromEntries(Object.entries(variants).map(([name, options]) => [name,
    createHash('sha256').update(JSON.stringify(buildForwardPlanningBoardGanttLayout(options))).digest('hex')]));
  expect(digests).toEqual({
    "resource": "b7661aa94e158317e3ada553af1ad3ee12dc8f045aeb92a16fa96c331065c435",
    "seiban": "d32672b547878f821f41cd2368ccc80be9d26483c7305a459443bce2c28fa88e",
    "explicit": "f3c78bbed2f58d0caf542e7965b6dfb0a3a694d255756521e93c68b6404e21b5",
    "mixed": "094399a04688b470604bfec4398120c9e8b623d306b3831f0c28c6ceb6d4f6f0",
    "incomplete": "8fb20ac3f89b57826ef37bada52189deae103ec92dfb4340db6c53c8b5bc3f41"
  });
});
