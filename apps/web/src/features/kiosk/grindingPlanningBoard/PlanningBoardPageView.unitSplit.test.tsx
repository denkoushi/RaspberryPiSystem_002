import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { PlanningBoardPageView } from './PlanningBoardPageView';

import type { PlanningBoardGanttProps } from './gantt/planningBoardGanttViewTypes';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted(() => ({ display: vi.fn() }));
vi.mock('./gantt/PlanningBoardGanttDisplay', () => ({ PlanningBoardGanttDisplay: (props: PlanningBoardGanttProps) => {
  mocks.display(props); return null;
} }));

it.each(['cutting', 'grinding', 'all'] as const)('allows only nonexcluded cutting resources in category %s', category => {
  const changeUnitSplit = vi.fn();
  const props = {
    data: { siteKey: 'test', resources: ['021', '022', '305', '306', '307'], resourceCategories: { '307': 'grinding' } },
    ganttEnabled: true, category, resourcesQuery: { data: { resourceNameMap: {}, resourceItems: [{ resourceCd: '306', excluded: true }, { resourceCd: '305', excluded: false }] } },
    gantt: { changeUnitSplit }, writeQueue: { pending: false }
  } as unknown as ComponentProps<typeof PlanningBoardPageView>;
  render(<PlanningBoardPageView {...props} />);
  const display = mocks.display.mock.lastCall![0] as PlanningBoardGanttProps;
  expect(display.onUnitSplitChange).toBe(changeUnitSplit);
  // 305 is a grinding resource in shared-types; 307 is marked grinding by the board.
  for (const resource of ['305', '306', '307', '未設定']) expect(display.unitSplitAvailable?.(resource)).toBe(false);
  for (const resource of ['021', '022', '023']) expect(display.unitSplitAvailable?.(resource)).toBe(category === 'cutting');
});
