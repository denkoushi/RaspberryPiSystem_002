import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';

import { PlanningBoardResourceMinutesSheet } from './PlanningBoardResourceMinutesSheet';

const { save, replaceGroups, groupQuery, groupMutation } = vi.hoisted(() => ({ save: vi.fn(), replaceGroups: vi.fn(), groupQuery: { data: undefined as import("@raspi-system/shared-types").ProductionScheduleSameModelResourceGroupsResponse | undefined }, groupMutation: { isPending: false } }));
vi.mock('../../../../api/hooks/production-schedule', () => ({
  useKioskSameModelResourceGroups: () => groupQuery,
  useReplaceKioskSameModelResourceGroups: () => ({ mutateAsync: replaceGroups, ...groupMutation }),
  useUpdateKioskGrindingPlanningBoardResourcePartMinutes: () => ({ mutateAsync: save })
}));
afterEach(() => { vi.useRealTimers(); save.mockReset(); replaceGroups.mockReset(); groupQuery.data = undefined; groupMutation.isPending = false; });

it('saves the same part independently for each resource', async () => {
  vi.useFakeTimers();
  save.mockResolvedValue({ values: [] });
  const base = productionFixture(1, 1).items[0]!;
  const items = ['021', '022'].map(resourceCd => ({ ...base, itemId: resourceCd, fhincd: 'SHARED-PART', originalResourceCd: resourceCd, effectiveResourceCd: resourceCd }));
  render(<PlanningBoardResourceMinutesSheet resourceCd="021" resourceCds={['021', '022']} items={items} values={[]} disabled={false} />);
  for (const [resourceCd, value] of [['021', '5'], ['022', '8']]) {
    const group = screen.getByText(resourceCd!).parentElement!.parentElement!;
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
  expect(screen.getByText('021 HCN1号機')).toBeInTheDocument();
  expect(screen.getByText('022 HCN2号機')).toBeInTheDocument();
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

function renderGroups(groups: Array<{ resourceCds: string[] }> = []) {
  groupQuery.data = { siteKey: 'site', groups, resources: ['021', '022', '023', '031', '032'].map((resourceCd) => ({ resourceCd, resourceName: `機械${resourceCd}` })) };
  replaceGroups.mockResolvedValue(groupQuery.data);
  const item = { ...productionFixture(1, 1).items[0]!, fhincd: 'CONFLICT', fhinmei: '部品名', effectiveResourceCd: '021' };
  return render(<PlanningBoardResourceMinutesSheet resourceCd="021" resourceCds={['021', '022']} items={[item]} values={[]} disabled={false} />);
}
it('adds a machine with the full groups and excludes self and grouped candidates', async () => {
  renderGroups([{ resourceCds: ['031', '032'] }]);
  const select = screen.getAllByLabelText('機械を足す')[0];
  expect(within(select).queryByRole('option', { name: '021 機械021' })).not.toBeInTheDocument();
  expect(within(select).queryByRole('option', { name: '031 機械031' })).not.toBeInTheDocument();
  fireEvent.change(select, { target: { value: '022' } });
  await waitFor(() => expect(replaceGroups).toHaveBeenCalledWith({ groups: [{ resourceCds: ['031', '032'] }, { resourceCds: ['021', '022'] }] }));
});
it.each([{ members: ['021', '022'], remaining: [] }, { members: ['021', '022', '023'], remaining: [{ resourceCds: ['022', '023'] }] }])('removes a member and retains only groups of two or more: $members', async ({ members, remaining }) => {
  renderGroups([{ resourceCds: members }, { resourceCds: ['031', '032'] }]);
  fireEvent.click(screen.getByLabelText('021を組から外す'));
  await waitFor(() => expect(replaceGroups).toHaveBeenCalledWith({ groups: [{ resourceCds: ['031', '032'] }, ...remaining] }));
});
it('dissolves a group and shows absent member chips in muted color', async () => {
  renderGroups([{ resourceCds: ['021', '022', '023'] }]);
  expect(screen.getByLabelText('023を組から外す').parentElement).toHaveClass('text-slate-400');
  fireEvent.click(screen.getByRole('button', { name: '組を解く' }));
  await waitFor(() => expect(replaceGroups).toHaveBeenCalledWith({ groups: [] }));
});
const groupConflict = { isAxiosError: true, response: { status: 409, data: { errorCode: 'SAME_MODEL_MINUTES_CONFLICT', details: {
  fhincds: ['CONFLICT', 'SECOND'], values: Object.fromEntries(['CONFLICT', 'SECOND'].map((fhincd) => [fhincd, {
    '021': { perUnitMinutes: 5, setupMinutes: 10, ops: [{ opNo: 1, setupMinutes: 10, minutes: 5 }] },
    '022': { perUnitMinutes: 8, setupMinutes: 20, ops: [{ opNo: 1, setupMinutes: 20, minutes: 8 }] }
  }]))
} } } };
it('resolves every conflicting part before resubmitting with resolutions', async () => {
  renderGroups(); replaceGroups.mockRejectedValueOnce(groupConflict);
  fireEvent.change(screen.getAllByLabelText('機械を足す')[0], { target: { value: '022' } });
  await screen.findByText('品番の値が食い違っています');
  expect(within(screen.getByRole('alert')).getByText('部品名')).toBeInTheDocument();
  const submit = screen.getByRole('button', { name: '組にする' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getAllByRole('button', { name: '022 機械022 1工程 20+8' })[0]);
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getAllByRole('button', { name: '021 機械021 1工程 10+5' })[1]);
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(replaceGroups).toHaveBeenLastCalledWith({ groups: [{ resourceCds: ['021', '022'] }], resolutions: { CONFLICT: '022', SECOND: '021' } }));
  await waitFor(() => expect(screen.queryByText('品番の値が食い違っています')).not.toBeInTheDocument());
});
it('cancels conflicts without another PUT or changing groups', async () => {
  renderGroups(); replaceGroups.mockRejectedValueOnce(groupConflict);
  fireEvent.change(screen.getAllByLabelText('機械を足す')[0], { target: { value: '022' } });
  await screen.findByText('品番の値が食い違っています');
  fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
  expect(screen.queryByText('品番の値が食い違っています')).not.toBeInTheDocument();
  expect(replaceGroups).toHaveBeenCalledTimes(1);
  expect(screen.getAllByLabelText('機械を足す')).toHaveLength(2);
});
it('shows the existing save error style for non-conflict failures', async () => {
  renderGroups(); replaceGroups.mockRejectedValueOnce(new Error('failed'));
  fireEvent.change(screen.getAllByLabelText('機械を足す')[0], { target: { value: '022' } });
  expect(await screen.findByText('保存できませんでした。')).toBeInTheDocument();
});
it('disables group actions while saving', () => {
  groupMutation.isPending = true;
  renderGroups([{ resourceCds: ['021', '022'] }]);
  expect(screen.getByLabelText('機械を足す')).toBeDisabled();
  expect(screen.getByLabelText('021を組から外す')).toBeDisabled();
  expect(screen.getByRole('button', { name: '組を解く' })).toBeDisabled();
});
