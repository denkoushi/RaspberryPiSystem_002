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
    "resource": "c9374fe0d814963147bad4e57caec086b5f32376f00f0507b821e5ce4d950c39",
    "seiban": "cd6068a9745a4753070b315397e3b1b5a4b3d272a7b763875c4fa554a1a0e06f",
    "explicit": "ca2c93e32ad84b5f9677dd7bd811343233b5baf198eedcce76e791580e301577",
    "mixed": "bf63825571de06a01f1f7b557c3d6e0a3b475e57de4509ce19cbc26042d213eb",
    "incomplete": "f4c6b5b1c1e8b3b4dbc73bd77cf122bd0f84b472d074914b77f05e2a5d6b4be8"
  });
});
