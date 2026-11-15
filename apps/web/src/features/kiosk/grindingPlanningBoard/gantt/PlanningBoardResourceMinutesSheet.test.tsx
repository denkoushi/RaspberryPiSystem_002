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

it('combines grouped machines into one heading, union of parts and one input per shared part', async () => {
  vi.useFakeTimers(); save.mockResolvedValue({ values: [] });
  const base = productionFixture(1, 1).items[0]!;
  const items = [
    { ...base, itemId: 'a', fhincd: 'GROUPED-PART', quantity: 6, effectiveResourceCd: '021' },
    { ...base, itemId: 'b', fhincd: 'GROUPED-PART', quantity: 2, effectiveResourceCd: '022' },
    { ...base, itemId: 'c', fhincd: 'ONLY-022', quantity: 4, effectiveResourceCd: '022' },
    { ...base, itemId: 'd', fhincd: 'STANDALONE', quantity: 1, effectiveResourceCd: '023' }
  ];
  render(<PlanningBoardResourceMinutesSheet resourceCd="021" resourceCds={['021', '022', '023']} siteKey="site"
    sameModelResourceGroups={[{ resourceCds: ['021', '022'] }]} resourceNameMap={{ '021': ['HCN1号機'], '022': ['HCN2号機'] }}
    items={items} values={[{ resourceCd: '021', fhincd: 'GROUPED-PART', perUnitMinutes: 5, setupMinutes: 10 }]} disabled={false} />);
  expect(screen.getByText('021 HCN1号機 / 022 HCN2号機')).toBeInTheDocument();
  const row = screen.getByText('GROUPED-PART').closest('tr')!;
  expect(within(row).getByText('8個', { exact: false })).toHaveTextContent('8個2件');
  expect(within(row).getByText('60分')).toBeInTheDocument();
  expect(screen.getAllByLabelText('GROUPED-PART 1台')).toHaveLength(1);
  expect(screen.getByLabelText('ONLY-022 1台')).toBeInTheDocument();
  expect(screen.getByText('023')).toBeInTheDocument(); expect(screen.getByLabelText('STANDALONE 1台')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('GROUPED-PART 1台'), { target: { value: '7' } });
  await act(async () => vi.advanceTimersByTime(400));
  expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toMatchObject({ resourceCd: '021', fhincd: 'GROUPED-PART', perUnitMinutes: 7 });
});

it('adds quantities and per-machine lot counts when split bars occupy both grouped machines', () => {
  const base = productionFixture(1, 1).items[0]!;
  const items = ['021', '022'].map((effectiveResourceCd, index) => ({ ...base, itemId: `split-${index}`, pieceId: 'unit', parentItemId: 'lot',
    fhincd: 'SPLIT-COUNT', effectiveResourceCd, quantity: 1, opRange: { fromOpNo: index + 1, toOpNo: index + 1 } }));
  render(<PlanningBoardResourceMinutesSheet resourceCd="021" resourceCds={['021', '022']} sameModelResourceGroups={[{ resourceCds: ['021', '022'] }]}
    items={items} values={[]} disabled={false} />);
  expect(screen.getByText('SPLIT-COUNT').closest('tr')).toHaveTextContent('2個2件');
  expect(screen.getAllByLabelText('SPLIT-COUNT 1台')).toHaveLength(1);
});
