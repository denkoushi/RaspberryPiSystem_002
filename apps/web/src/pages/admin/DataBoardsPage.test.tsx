import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const setSelectedId = vi.fn();
const handleSelectChange = vi.fn();

vi.mock('../../features/admin/csv-dashboards/useCsvDashboardEditor', () => ({
  useCsvDashboardEditor: () => ({
    selectedId: 'table-1',
    setSelectedId,
    selected: { id: 'table-1', name: '生産日程', templateType: 'CARD_GRID' },
    dashboards: [{ id: 'table-1', name: '生産日程', enabled: true }],
    dashboardsQuery: { isLoading: false, isError: false },
    selectedDashboardQuery: { isLoading: false, isError: false },
    createInspectionDashboardMutation: { mutate: vi.fn(), isPending: false },
    updateMutation: {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      isSuccess: false,
      error: Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: {
          data: {
            message:
              '「DocumentASM」は組立手順書専用の件名です。このメールに一致するCSV件名パターンは登録できません。',
          },
        },
      }),
    },
    columnDefinitionError: null,
  }),
}));
vi.mock('../../features/admin/visualization-dashboards/useVisualizationDashboardEditor', () => ({
  useVisualizationDashboardEditor: () => ({
    dashboards: [{ id: 'graph-1', name: '未点検加工機', enabled: true }],
    dashboardsQuery: { isLoading: false, isError: false },
    selected: null,
    isCreating: false,
    setIsCreating: vi.fn(),
    handleSelectChange,
    currentCsvDashboardId: null,
    applyUninspectedPreset: vi.fn(),
    applyMeasuringInspectionPreset: vi.fn(),
    applyRiggingInspectionPreset: vi.fn(),
    applyPalletVisualizationPreset: vi.fn(),
  }),
}));
vi.mock('../../api/hooks', () => ({
  useSignageSchedulesForManagement: () => ({
    data: [
      {
        id: 's1',
        name: '午後の表示',
        contentType: 'TOOLS',
        pdfId: null,
        enabled: true,
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: '13:00',
        endTime: '17:00',
        priority: 0,
        targetClientKeys: [],
        layoutConfig: { layout: 'FULL', slots: [{ position: 'FULL', kind: 'csv_dashboard', config: { csvDashboardId: 'table-1' } }] },
      },
    ],
  }),
}));
vi.mock('../../features/admin/data-boards/useBoardPreviewImage', () => ({
  useBoardPreviewImage: () => ({ imageUrl: null, error: null, isLoading: false }),
}));
vi.mock('../../features/admin/csv-dashboards/CsvDashboardBasicSettingsFields', () => ({
  CsvDashboardBasicSettingsFields: () => null,
}));
vi.mock('../../features/admin/csv-dashboards/CsvDashboardColumnDefinitionsTable', () => ({
  CsvDashboardColumnDefinitionsTable: () => null,
}));
vi.mock('../../features/admin/csv-dashboards/CsvDashboardPreviewSection', () => ({
  CsvDashboardPreviewSection: () => null,
}));
vi.mock('../../features/admin/csv-dashboards/CsvDashboardTableTemplateSection', () => ({
  CsvDashboardTableTemplateSection: () => null,
}));
vi.mock('../../features/admin/csv-dashboards/CsvDashboardUploadSection', () => ({
  CsvDashboardUploadSection: () => null,
}));
vi.mock('../../features/admin/visualization-dashboards/VisualizationDashboardEditorForm', () => ({
  VisualizationDashboardEditorForm: () => null,
}));

import { DataBoardsPage } from './DataBoardsPage';

function renderPage(initialEntry = '/admin/data-boards') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DataBoardsPage />
    </MemoryRouter>,
  );
}

describe('DataBoardsPage', () => {
  it('lists graphs and tables together with their signage usage, used boards first', () => {
    renderPage();
    const items = screen.getAllByRole('button', { name: /生産日程|未点検加工機/ });
    expect(items[0]).toHaveTextContent('生産日程');
    expect(items[0]).toHaveTextContent('サイネージ 1件');
    expect(items[1]).toHaveTextContent('未点検加工機');
    expect(items[1]).toHaveTextContent('未使用');
  });

  it('honours the type filter passed by the old page URLs', () => {
    renderPage('/admin/data-boards?type=graph');
    expect(screen.queryByRole('button', { name: /生産日程/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /未点検加工機/ })).toBeInTheDocument();
  });

  it('shows where a table is used and the concrete API reason when saving fails', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /生産日程/ }));

    expect(setSelectedId).toHaveBeenCalledWith('table-1');
    expect(screen.getByRole('link', { name: /午後の表示/ })).toHaveTextContent('月〜金 13:00–17:00');
    expect(screen.getByRole('alert')).toHaveTextContent(
      '「DocumentASM」は組立手順書専用の件名です。このメールに一致するCSV件名パターンは登録できません。',
    );
  });
});
