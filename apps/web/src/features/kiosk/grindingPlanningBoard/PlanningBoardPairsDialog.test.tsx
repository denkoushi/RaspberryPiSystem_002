import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { PlanningBoardPairsDialog } from './PlanningBoardPairsDialog';

import type { GrindingPlanningBoardPair } from '../../../api/domains/production-schedule/grinding-planning-board';

const api = vi.hoisted(() => ({
  list: vi.fn(), suggestions: vi.fn(), create: vi.fn(), remove: vi.fn()
}));
vi.mock('../../../api/domains/production-schedule/grinding-planning-board', () => ({
  getKioskGrindingPlanningBoardPairs: api.list,
  getKioskGrindingPlanningBoardPairSuggestions: api.suggestions,
  createKioskGrindingPlanningBoardPair: api.create,
  deleteKioskGrindingPlanningBoardPair: api.remove
}));
vi.mock('../../../api/hooks/production-schedule/grinding-planning-board-test-bar-parts', () => ({
  usePlanningBoardTestBarPartCandidates: () => ({
    data: { parts: ['足（１）', '足（２）', 'テーブル', 'スタンド（１）', 'スタンド（２）'].map((partName) => ({ partName, machineStock: false })) }
  })
}));

let pairs: GrindingPlanningBoardPair[];
beforeEach(() => {
  vi.resetAllMocks();
  pairs = [{ id: 'registered', firstPartName: 'スタンド（１）', secondPartName: 'スタンド（２）' }];
  api.list.mockImplementation(async () => ({ pairs }));
  api.create.mockImplementation(async (firstPartName: string, secondPartName: string) => {
    const pair = { id: 'new', firstPartName, secondPartName };
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
  return within(screen.getByRole('group', { name: '品名候補' }));
}

it('selects the highest ranked available suggestion and registers the pair', async () => {
  api.suggestions.mockResolvedValue({ suggestions: [
    { partName: 'スタンド（１）', seibanCount: 250 },
    { partName: '足（２）', seibanCount: 190 },
    { partName: 'テーブル', seibanCount: 41 }
  ] });
  const candidates = openDialog();
  expect(screen.getByRole('dialog', { name: '組' })).toBeInTheDocument();
  const first = candidates.getByRole('button', { name: '足（１）' });
  await waitFor(() => expect(first).toBeEnabled());
  expect(candidates.getByRole('button', { name: 'スタンド（１） ⇄ スタンド（２）' })).toBeDisabled();
  fireEvent.click(first);

  expect(await candidates.findByRole('button', { name: '足（２） 190製番' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '2つ目 足（２）' })).toBeEnabled();
  fireEvent.click(candidates.getByRole('button', { name: 'テーブル 41製番' }));
  expect(screen.getByRole('button', { name: '2つ目 テーブル' })).toBeEnabled();
  fireEvent.click(candidates.getByRole('button', { name: '足（２） 190製番' }));
  fireEvent.click(screen.getByRole('button', { name: '組にする' }));

  const remove = await screen.findByRole('button', { name: '足（１） ⇄ 足（２）を削除' });
  expect(api.create).toHaveBeenCalledWith('足（１）', '足（２）');
  expect(candidates.getByRole('button', { name: '足（１） ⇄ 足（２）' })).toBeDisabled();
  await waitFor(() => expect(remove).toBeEnabled());
  fireEvent.click(remove);
  await waitFor(() => expect(remove).not.toBeInTheDocument());
  expect(api.remove).toHaveBeenCalledWith('new');
});

it('uses the keyboard-filtered candidates when there are no suggestions and resets from the first slot', async () => {
  api.suggestions.mockResolvedValue({ suggestions: [] });
  const candidates = openDialog();
  fireEvent.click(screen.getByRole('button', { name: 'て', exact: true }));
  const table = candidates.getByRole('button', { name: 'テーブル' });
  await waitFor(() => expect(table).toBeEnabled());
  expect(candidates.queryByRole('button', { name: '足（１）' })).not.toBeInTheDocument();
  fireEvent.click(table);
  await waitFor(() => expect(api.suggestions).toHaveBeenCalledWith('テーブル'));
  fireEvent.click(screen.getByRole('button', { name: '全部消す' }));
  const foot = candidates.getByRole('button', { name: '足（１）' });
  await waitFor(() => expect(foot).toBeEnabled());
  fireEvent.click(foot);
  expect(screen.getByRole('button', { name: '2つ目 足（１）' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '1つ目 テーブル' }));
  expect(screen.getByRole('button', { name: '組にする' })).toBeDisabled();
});
