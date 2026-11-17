import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { usePlanningBoardTestBarPartCandidates } from './grinding-planning-board-test-bar-parts';

import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ candidates: vi.fn() }));
vi.mock('../../domains/production-schedule/grinding-planning-board', () => ({ getKioskGrindingPlanningBoardTestBarPartCandidates: api.candidates }));

it('waits for a machine and never uses the previous machine candidates while loading', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  api.candidates.mockResolvedValueOnce({ parts: [{ partName: 'モータブラケット', machineStock: true }] });
  const { result, rerender, unmount } = renderHook(({ resource }) => usePlanningBoardTestBarPartCandidates(resource), { wrapper, initialProps: { resource: '' } });
  expect(api.candidates).not.toHaveBeenCalled();
  rerender({ resource: '300' });
  await waitFor(() => expect(result.current.data?.parts).toEqual([{ partName: 'モータブラケット', machineStock: true }]));
  let resolve!: (value: { parts: Array<{ partName: string; machineStock: boolean }> }) => void;
  api.candidates.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  rerender({ resource: '301' });
  expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith('301'));
  resolve({ parts: [{ partName: '軸受', machineStock: false }] });
  await waitFor(() => expect(result.current.data?.parts).toEqual([{ partName: '軸受', machineStock: false }]));
  unmount();
  client.clear();
});
