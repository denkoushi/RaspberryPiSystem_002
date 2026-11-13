import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../../api/client';

import { productionFixture } from './__perf__/fixture';
import { buildPlanningBoardGanttLayout } from './gantt/planningBoardGanttLayout';
import { PlanningBoardGanttView } from './gantt/PlanningBoardGanttView';
import { planningBoardChainCompletedKey, usePlanningBoardPageChainItems } from './usePlanningBoardChainItems';

import type { PlanningBoardStatus } from './types';

vi.mock('../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
afterEach(() => vi.restoreAllMocks());

function setup(status: PlanningBoardStatus = 'incomplete', fseiban = '26-1001') {
  const fixture = productionFixture(1, 1);
  const pending = { ...fixture.items[0]!, itemId: 'pending', fseiban, requiredMinutes: 60, isCompleted: false };
  const completed = { ...pending, itemId: 'completed', kind: 'piece' as const, parentItemId: 'parent', isCompleted: true };
  const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items: [pending], mode: 'forward' });
  const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { items: [completed, pending], nextCursor: null } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Board({ status }: { status: PlanningBoardStatus }) {
    const { chainItems, onChainPartChange } = usePlanningBoardPageChainItems({
      category: 'grinding', view: 'resource', scheduleSource: 'both', dueSource: 'scaw', completionFilter: status
    }, [pending]);
    return <><span data-testid="chain-count">{chainItems.length}</span><PlanningBoardGanttView layout={layout} scale={14} dailyHoursByResource={{}}
      resourceNameMap={{}} capacityPending={false} capacityError={false} onCapacityChange={vi.fn()} onToggleItem={vi.fn()}
      onDueDrop={vi.fn()} focusedSeiban={null} onFocusedSeibanChange={vi.fn()} selectedItemIds={new Set()} resourceView chainItems={chainItems} onChainPartChange={onChainPartChange} /></>;
  }
  const view = render(<QueryClientProvider client={client}><Board status={status} /></QueryClientProvider>);
  return { get, client, completed, ...view };
}

describe('chain completed items', () => {
  it.each(['26-1001', '********'])('fetches only the open chain seiban %s and renders its completed piece', async fseiban => {
    const { get, client } = setup('incomplete', fseiban);
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('planning-gantt-bar-pending'));
    await waitFor(() => expect(within(screen.getByTestId('planning-gantt-chain-strip')).getAllByRole('button', { name: /工順/ })).toHaveLength(2));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/kiosk/production-schedule/grinding-planning-board', { params: expect.objectContaining({
      fseibans: fseiban, completionFilter: 'complete', includePieces: true, category: 'grinding', view: 'resource', scheduleSource: 'both', dueSource: 'scaw'
    }) });
    expect(screen.getByTestId('chain-count')).toHaveTextContent('2');
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await act(async () => { await client.invalidateQueries({ queryKey: planningBoardChainCompletedKey }); });
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(within(screen.getByTestId('planning-gantt-chain-strip')).getAllByRole('button', { name: /工順/ })).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId('planning-gantt-chain-strip')).getByRole('button', { name: '工程のつながりを閉じる' }));
    await act(async () => { await client.invalidateQueries({ queryKey: planningBoardChainCompletedKey }); });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not fetch with all status even when the chain opens', () => {
    const { get } = setup('all');
    fireEvent.click(screen.getByTestId('planning-gantt-bar-pending'));
    expect(screen.getByTestId('planning-gantt-chain-strip')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
