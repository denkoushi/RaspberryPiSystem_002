import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';

import { PlanningBoardResourceMinutesSheet } from './PlanningBoardResourceMinutesSheet';

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../../../api/hooks/production-schedule', () => ({
  useUpdateKioskGrindingPlanningBoardResourcePartMinutes: () => ({ mutateAsync: save })
}));
afterEach(() => { vi.useRealTimers(); save.mockReset(); });

it('saves the same part independently for each resource', async () => {
  vi.useFakeTimers();
  save.mockResolvedValue({ values: [] });
  const base = productionFixture(1, 1).items[0]!;
  const items = ['021', '022'].map(resourceCd => ({ ...base, itemId: resourceCd, fhincd: 'SHARED-PART', originalResourceCd: resourceCd, effectiveResourceCd: resourceCd }));
  render(<PlanningBoardResourceMinutesSheet resourceCd="021" resourceCds={['021', '022']} items={items} values={[]} disabled={false} />);
  for (const [resourceCd, value] of [['021', '5'], ['022', '8']]) {
    const group = screen.getByText(resourceCd!).parentElement!;
    fireEvent.change(within(group).getByLabelText('SHARED-PART 1台'), { target: { value } });
  }
  await act(async () => vi.advanceTimersByTime(400));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls.map(([payload]) => ({ resourceCd: payload.resourceCd, fhincd: payload.fhincd, perUnitMinutes: payload.perUnitMinutes }))).toEqual([
    { resourceCd: '021', fhincd: 'SHARED-PART', perUnitMinutes: 5 },
    { resourceCd: '022', fhincd: 'SHARED-PART', perUnitMinutes: 8 }
  ]);
});
