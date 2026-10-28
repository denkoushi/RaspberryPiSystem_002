import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getVisualizationDashboard, updateVisualizationDashboard } from '../../../api/client';
import { csvVisualizationQueryKeys } from '../../../api/queryKeys/csvVisualization';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import { useVisualizationDashboardEditor } from '../visualization-dashboards/useVisualizationDashboardEditor';

import { GraphBoardForm } from './GraphBoardForm';

import type { VisualizationDashboard } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  getVisualizationDashboards: vi.fn(async () => []),
  getCsvDashboards: vi.fn(async () => [{ id: 'csv', name: '点検結果', enabled: true }]),
  getVisualizationDashboard: vi.fn(),
  updateVisualizationDashboard: vi.fn(),
  createVisualizationDashboard: vi.fn(),
  deleteVisualizationDashboard: vi.fn(),
  getToolsPalletVisualizationBoard: vi.fn(),
}));
// Exercise the real query and mutation hooks, without unrelated hook modules.
vi.mock('../../../api/hooks', async () => import('../../../api/hooks/csv-visualization'));
vi.mock('../../../api/hooks/tools', () => ({
  useMachines: () => ({ data: [], isLoading: false, isError: false }),
}));

function makeDashboard(id: string, date: string): VisualizationDashboard {
  return {
    id, name: id, description: 'description', enabled: true,
    dataSourceType: 'hydraulic_oil_exchange', rendererType: 'hydraulic_oil_exchange',
    dataSourceConfig: {
      csvDashboardId: 'csv', targetEquipmentNumbers: ['M1', 'M2'],
      manualLastExchangeDates: { M1: date, M2: '2026-02-01' },
    },
    rendererConfig: {},
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const observeSelected = vi.fn();

function Harness() {
  const editor = useVisualizationDashboardEditor();
  observeSelected(editor.selected);
  return <>
    <button onClick={() => editor.handleSelectChange('first')}>select first</button>
    <button onClick={() => editor.handleSelectChange('second')}>select second</button>
    <button onClick={() => editor.setIsCreating(true)}>new dashboard</button>
    <GraphBoardForm editor={editor} onSaved={() => undefined} />
  </>;
}

function renderEditor() {
  // Ensure a same-version refetch delivers a new object identity to the editor.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, structuralSharing: false } } });
  render(<QueryClientProvider client={client}><ConfirmProvider><Harness /></ConfirmProvider></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'select first' }));
  return client;
}

const readConfig = () => JSON.parse((screen.getByLabelText('データの設定（JSON）') as HTMLTextAreaElement).value);

describe('GraphBoardForm with the visualization editor', () => {
  beforeEach(() => {
    vi.mocked(getVisualizationDashboard).mockReset();
    vi.mocked(getVisualizationDashboard).mockImplementation(async (id) => makeDashboard(id, id === 'first' ? '2026-04-01' : '2026-05-01'));
    vi.mocked(updateVisualizationDashboard).mockReset();
    vi.mocked(updateVisualizationDashboard).mockResolvedValue(makeDashboard('first', '2026-04-01'));
  });

  it('clears visibly, preserves unsaved edits through a same-version refetch, saves the removed key, and loads a different id', async () => {
    const client = renderEditor();
    await waitFor(() => expect(screen.getByLabelText('M1')).toHaveValue('2026-04-01'));
    const beforeRefetch = client.getQueryData(csvVisualizationQueryKeys.visualizationDashboard('first'));
    fireEvent.click(screen.getByRole('button', { name: 'M1の前回交換日をクリア' }));
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'unsaved name' } });
    expect(screen.getByLabelText('M1')).toHaveValue('');
    expect(readConfig().manualLastExchangeDates).toEqual({ M2: '2026-02-01' });
    await act(async () => { await client.refetchQueries({ queryKey: csvVisualizationQueryKeys.visualizationDashboard('first') }); });
    expect(client.getQueryData(csvVisualizationQueryKeys.visualizationDashboard('first'))).not.toBe(beforeRefetch);
    await waitFor(() => expect(observeSelected.mock.lastCall?.[0]).toBe(client.getQueryData(csvVisualizationQueryKeys.visualizationDashboard('first'))));
    expect(screen.getByLabelText('M1')).toHaveValue('');
    expect(screen.getByLabelText('名前')).toHaveValue('unsaved name');
    expect(readConfig().manualLastExchangeDates).toEqual({ M2: '2026-02-01' });
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }));
    await waitFor(() => expect(updateVisualizationDashboard).toHaveBeenCalledWith('first', expect.objectContaining({
      name: 'unsaved name', dataSourceConfig: expect.objectContaining({ manualLastExchangeDates: { M2: '2026-02-01' } }),
    })));
    fireEvent.click(screen.getByRole('button', { name: 'select second' }));
    await waitFor(() => expect(screen.getByLabelText('M1')).toHaveValue('2026-05-01'));
    expect(screen.getByLabelText('名前')).toHaveValue('second');
    client.clear();
  });

  it('loads a newer server version, including the other editor fields', async () => {
    const client = renderEditor();
    await waitFor(() => expect(screen.getByLabelText('M1')).toHaveValue('2026-04-01'));
    fireEvent.click(screen.getByRole('button', { name: 'M1の前回交換日をクリア' }));
    const updated = {
      ...makeDashboard('first', '2026-06-01'), updatedAt: '2026-02-01T00:00:00.000Z',
      name: 'server name', description: 'server description', enabled: false,
      dataSourceType: 'custom_source', rendererType: 'custom_renderer', rendererConfig: { theme: 'light' },
    };
    vi.mocked(getVisualizationDashboard).mockResolvedValue(updated);
    await act(async () => { await client.refetchQueries({ queryKey: csvVisualizationQueryKeys.visualizationDashboard('first') }); });
    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('server name'));
    expect(screen.getByLabelText('説明')).toHaveValue('server description');
    expect(screen.getByLabelText('データの種類')).toHaveValue('custom_source');
    expect(screen.getByLabelText('描き方の種類')).toHaveValue('custom_renderer');
    expect(JSON.parse((screen.getByLabelText('描き方の設定（JSON）') as HTMLTextAreaElement).value)).toEqual({ theme: 'light' });
    expect(readConfig()).toEqual(updated.dataSourceConfig);
    expect(screen.getByRole('switch', { name: '有効' })).toHaveAttribute('aria-checked', 'false');
    client.clear();
  });

  it('reloads the same dashboard after leaving it to create a new one', async () => {
    const client = renderEditor();
    await waitFor(() => expect(screen.getByLabelText('M1')).toHaveValue('2026-04-01'));
    fireEvent.click(screen.getByRole('button', { name: 'M1の前回交換日をクリア' }));
    fireEvent.click(screen.getByRole('button', { name: 'new dashboard' }));
    expect(screen.getByLabelText('名前')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'select first' }));
    await waitFor(() => expect(screen.getByLabelText('M1')).toHaveValue('2026-04-01'));
    client.clear();
  });
});
