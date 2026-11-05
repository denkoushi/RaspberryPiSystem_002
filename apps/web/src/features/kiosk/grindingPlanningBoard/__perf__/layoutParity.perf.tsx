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
    "resource": "19b035ba2343f59f851367c8f4dec7f7dc35ee088abfdd1ebda1f79b3d077c2a",
    "seiban": "5a08642628fa40d2a9c2217b01176c83b440fecb8a79905e58bb0d347f484dab",
    "explicit": "95f1186639225fbf3b5ea842d57f15de68502856f267dfff4926e5ce2fb7db2e",
    "mixed": "7164ccc1dacca9ba3d224ee9d65bbfe40570c77594d556044fc3bfbdf6bf0bc1",
    "incomplete": "3decb019e1d3f891e53ba62393b0f7e2463305404cdbcacd77d0070553b79f0d"
  });
});
