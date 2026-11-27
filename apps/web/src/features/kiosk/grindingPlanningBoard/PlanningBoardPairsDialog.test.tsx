import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { PlanningBoardPairsDialog } from './PlanningBoardPairsDialog';

import type { GrindingPlanningBoardPair } from '../../../api/domains/production-schedule/grinding-planning-board';

const api = vi.hoisted(() => ({
  list: vi.fn(), candidates: vi.fn(), status: vi.fn(), suggestions: vi.fn(), create: vi.fn(), remove: vi.fn()
}));
vi.mock('../../../api/domains/production-schedule/grinding-planning-board', () => ({
  getKioskGrindingPlanningBoardPairs: api.list,
  getKioskGrindingPlanningBoardPairCandidates: api.candidates,
  getKioskGrindingPlanningBoardPairStatus: api.status,
  getKioskGrindingPlanningBoardPairSuggestions: api.suggestions,
  createKioskGrindingPlanningBoardPair: api.create,
  deleteKioskGrindingPlanningBoardPair: api.remove
}));

const foot1 = { partName: '足（１）', partCode: 'MD004291472' };
const foot2 = { partName: '足（２）', partCode: 'MD004291481' };
const otherFoot1 = { ...foot1, partCode: 'MD004239990' };
const table = { partName: 'テーブル', partCode: 'MD000006755' };
const stand1 = { partName: 'スタンド（１）', partCode: 'MD005188121' };
const stand2 = { partName: 'スタンド（２）', partCode: 'MD005188150' };
const label = (part: typeof foot1) => `${part.partName} ${part.partCode}`;
const pairFields = (first: typeof foot1, second: typeof foot1) => ({
  firstPartCode: first.partCode, firstPartName: first.partName,
  secondPartCode: second.partCode, secondPartName: second.partName
});

let pairs: GrindingPlanningBoardPair[];
beforeEach(() => {
  vi.resetAllMocks();
  pairs = [{ id: 'registered', ...pairFields(stand1, stand2) }];
  api.list.mockImplementation(async () => ({ pairs }));
  api.candidates.mockResolvedValue({ parts: [foot1, foot2, otherFoot1, table, stand1, stand2] });
  api.status.mockResolvedValue({ parts: [foot1, foot2, otherFoot1, stand1, stand2].map((part, index) => ({
    ...part, seibanCount: [146, 146, 29, 26, 26][index]
  })) });
  api.suggestions.mockResolvedValue({ suggestions: [] });
  api.create.mockImplementation(async (fields: Omit<GrindingPlanningBoardPair, 'id'>) => {
    const pair = { id: 'new', ...fields };
    pairs = [...pairs, pair];
    return { pair };
  });
  api.remove.mockImplementation(async (id: string) => {
    pairs = pairs.filter((pair) => pair.id !== id);
    return { deleted: true };
  });
});

function openDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PlanningBoardPairsDialog onClose={vi.fn()} /></QueryClientProvider>);
  return {
    candidates: within(screen.getByRole('group', { name: '品番候補' })),
    status: within(screen.getByRole('group', { name: '組の有無' }))
  };
}

it('selects the highest ranked available suggestion and registers the pair', async () => {
  api.suggestions.mockResolvedValue({ suggestions: [
    { ...stand1, seibanCount: 250 },
    { ...foot2, seibanCount: 190 },
    { ...table, seibanCount: 41 }
  ] });
  const { candidates, status } = openDialog();
  expect(screen.getByRole('dialog', { name: '組' })).toBeInTheDocument();
  const first = await candidates.findByRole('button', { name: label(foot1) });
  await waitFor(() => expect(first).toBeEnabled());
  fireEvent.click(first);

  expect(await candidates.findByRole('button', { name: `${label(foot2)} 190製番` })).toHaveAttribute('aria-pressed', 'true');
  expect(api.suggestions).toHaveBeenCalledWith(foot1.partCode);
  expect(candidates.queryByRole('button', { name: /250製番/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: `2つ目 ${label(foot2)}` })).toBeEnabled();
  fireEvent.click(candidates.getByRole('button', { name: `${label(table)} 41製番` }));
  expect(screen.getByRole('button', { name: `2つ目 ${label(table)}` })).toBeEnabled();
  fireEvent.click(candidates.getByRole('button', { name: `${label(foot2)} 190製番` }));
  fireEvent.click(screen.getByRole('button', { name: '組にする' }));

  const remove = await status.findByRole('button', { name: `${label(foot1)} ⇄ ${label(foot2)}を削除` });
  expect(api.create).toHaveBeenCalledWith(pairFields(foot1, foot2));
  await waitFor(() => expect(remove).toBeEnabled());
  expect(candidates.getByRole('button', { name: `${label(foot1)} ⇄ ${foot2.partCode}` })).toBeEnabled();
  fireEvent.click(remove);
  await waitFor(() => expect(remove).not.toBeInTheDocument());
  expect(api.remove).toHaveBeenCalledWith('new');
});

it('uses kana and code keys in the fallback candidates and resets from the first slot', async () => {
  const { candidates } = openDialog();
  const tableButton = await candidates.findByRole('button', { name: label(table) });
  await waitFor(() => expect(tableButton).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'て', exact: true }));
  expect(candidates.queryByRole('button', { name: label(foot1) })).not.toBeInTheDocument();
  fireEvent.click(tableButton);
  await waitFor(() => expect(api.suggestions).toHaveBeenCalledWith(table.partCode));
  fireEvent.click(screen.getByRole('button', { name: '全部消す' }));
  fireEvent.click(screen.getByRole('button', { name: '英数' }));
  for (const key of 'MD00423') fireEvent.click(screen.getByRole('button', { name: key, exact: true }));
  const foot = candidates.getByRole('button', { name: label(otherFoot1) });
  await waitFor(() => expect(foot).toBeEnabled());
  expect(candidates.queryByRole('button', { name: label(foot1) })).not.toBeInTheDocument();
  fireEvent.click(foot);
  expect(screen.getByRole('button', { name: `2つ目 ${label(otherFoot1)}` })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: `1つ目 ${label(table)}` }));
  expect(screen.getByRole('button', { name: '組にする' })).toBeDisabled();
});

it('shows pair coverage and opens registered pairs from either list', async () => {
  const { candidates, status } = openDialog();
  expect(await screen.findByText('組 2 / 5')).toBeInTheDocument();
  const unpaired = status.getByRole('button', { name: `${label(otherFoot1)} 未 29製番` });
  fireEvent.click(unpaired);
  expect(screen.getByRole('button', { name: `1つ目 ${label(otherFoot1)}` })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: `1つ目 ${label(otherFoot1)}` }));

  const stand = candidates.getByRole('button', { name: `${label(stand1)} ⇄ ${stand2.partCode}` });
  expect(stand).toBeEnabled();
  fireEvent.click(stand);
  expect(screen.getByRole('button', { name: `2つ目 ${label(stand2)}` })).toBeDisabled();
  expect(screen.getByRole('button', { name: '登録済み' })).toBeDisabled();
  fireEvent.click(status.getByRole('button', { name: `${label(stand2)} ⇄ ${label(stand1)}` }));
  expect(screen.getByRole('button', { name: `1つ目 ${label(stand2)}` })).toBeEnabled();
  expect(screen.getByRole('button', { name: `2つ目 ${label(stand1)}` })).toBeDisabled();
  expect(api.suggestions).not.toHaveBeenCalledWith(stand1.partCode);
  expect(api.suggestions).not.toHaveBeenCalledWith(stand2.partCode);
});
