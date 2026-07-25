import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../features/admin/csv-dashboards/useCsvDashboardEditor', () => ({
  useCsvDashboardEditor: () => ({
    selectedId: 'dashboard-1',
    selected: { id: 'dashboard-1', templateType: 'CARD_GRID' },
    selectedDashboardQuery: { isLoading: false, isError: false },
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

vi.mock('../../features/admin/csv-dashboards/CsvDashboardHeaderSection', () => ({
  CsvDashboardHeaderSection: () => null,
}));
vi.mock('../../features/admin/csv-dashboards/CsvDashboardListSection', () => ({
  CsvDashboardListSection: () => null,
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

import { CsvDashboardsPage } from './CsvDashboardsPage';

describe('CsvDashboardsPage', () => {
  it('shows the concrete API reason when a reserved Gmail subject cannot be saved', () => {
    render(<CsvDashboardsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '「DocumentASM」は組立手順書専用の件名です。このメールに一致するCSV件名パターンは登録できません。'
    );
  });
});
