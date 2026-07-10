import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskInspectionDrawingLibraryPage } from './KioskInspectionDrawingLibraryPage';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../../features/part-measurement/types';

const apiMocks = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  listVisuals: vi.fn(),
  retireTemplate: vi.fn(),
  confirm: vi.fn()
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    getResolvedClientKey: vi.fn(() => undefined),
    listKioskInspectionDrawingTemplates: apiMocks.listTemplates,
    listPartMeasurementVisualTemplates: apiMocks.listVisuals,
    retirePartMeasurementTemplate: apiMocks.retireTemplate,
    updatePartMeasurementVisualTemplateName: vi.fn()
  };
});

vi.mock('../../api/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../api/hooks')>('../../api/hooks');
  return {
    ...actual,
    useKioskProductionScheduleResources: () => ({
      data: { resources: ['R001'], resourceNameMap: {} }
    })
  };
});

const template: KioskInspectionDrawingTemplateSummaryDto = {
  id: 'template-1',
  fhincd: 'PART-9000',
  resourceCd: 'R001',
  processGroup: 'cutting',
  name: '図面71-A61 テンプレート',
  version: 1,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: 'visual-1',
  visualTemplate: {
    id: 'visual-1',
    name: '図面71-A61',
    drawingImageRelativePath: '/api/storage/part-measurement-drawings/visual-1.png',
    isActive: true,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  },
  siblingGroupId: null,
  siblingGroup: null,
  itemCount: 1
};

const inactiveTemplate: KioskInspectionDrawingTemplateSummaryDto = {
  ...template,
  id: 'template-inactive',
  fhincd: 'PART-RETIRED',
  resourceCd: 'R002',
  name: '無効化済みテンプレート',
  version: 2,
  isActive: false,
  visualTemplateId: 'visual-inactive',
  visualTemplate: {
    ...template.visualTemplate!,
    id: 'visual-inactive',
    name: '無効化済み図面'
  }
};

function renderPage() {
  return render(
    <MemoryRouter>
      <KioskInspectionDrawingLibraryPage />
    </MemoryRouter>
  );
}

describe('KioskInspectionDrawingLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listTemplates.mockResolvedValue([template]);
    apiMocks.listVisuals.mockResolvedValue([template.visualTemplate]);
    apiMocks.retireTemplate.mockResolvedValue({});
    apiMocks.confirm.mockReturnValue(true);
    vi.stubGlobal('confirm', apiMocks.confirm);
  });

  it('keeps the retire action visible and uses 無効ON/OFF to show or hide inactive templates', async () => {
    apiMocks.listTemplates.mockImplementation(({ includeInactive }: { includeInactive?: boolean }) =>
      Promise.resolve(includeInactive ? [template, inactiveTemplate] : [template])
    );
    renderPage();
    await screen.findAllByText('図面71-A61');

    expect(screen.getByRole('button', { name: '無効', exact: true })).toBeEnabled();
    expect(screen.queryByText('PART-RETIRED')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '無効ON' }));
    await screen.findByText('PART-RETIRED');
    expect(screen.getAllByRole('button', { name: '無効', exact: true })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '無効', exact: true }).filter((button) => button.hasAttribute('disabled'))).toHaveLength(1);
    expect(apiMocks.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeInactive: true })
    );

    fireEvent.click(screen.getByRole('button', { name: '無効OFF' }));
    await waitFor(() => expect(screen.queryByText('PART-RETIRED')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '無効', exact: true })).toBeEnabled();
    expect(apiMocks.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeInactive: false })
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '履歴' }));
    await waitFor(() =>
      expect(apiMocks.listTemplates).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeInactive: true })
      )
    );
    expect(screen.queryByText('PART-RETIRED')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '無効', exact: true })).toBeEnabled();
  });

  it('keeps confirmation and hides a newly retired template while inactive items are off', async () => {
    let isRetired = false;
    apiMocks.listTemplates.mockImplementation(({ includeInactive }: { includeInactive?: boolean }) =>
      Promise.resolve(isRetired ? (includeInactive ? [{ ...template, isActive: false }] : []) : [template])
    );
    apiMocks.retireTemplate.mockImplementation(() => {
      isRetired = true;
      return Promise.resolve({});
    });
    renderPage();
    await screen.findAllByText('図面71-A61');

    const retireButton = screen.getByRole('button', { name: '無効', exact: true });

    apiMocks.confirm.mockReturnValueOnce(false);
    fireEvent.click(retireButton);
    expect(apiMocks.retireTemplate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '無効ON' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(retireButton);
    await waitFor(() => expect(apiMocks.retireTemplate).toHaveBeenCalledWith('template-1'));
    await waitFor(() => expect(screen.queryByText('PART-9000')).not.toBeInTheDocument());
    expect(screen.getByText(/テンプレートを無効化しました/)).toBeInTheDocument();
  });

  it('locks the inactive visibility toggle and prevents duplicate retire requests while one is pending', async () => {
    let resolveRetire: (() => void) | undefined;
    apiMocks.retireTemplate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRetire = resolve;
        })
    );
    renderPage();
    await screen.findAllByText('図面71-A61');

    const retireButton = screen.getByRole('button', { name: '無効', exact: true });
    fireEvent.click(retireButton);
    fireEvent.click(retireButton);

    expect(apiMocks.retireTemplate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '無効ON' })).toBeDisabled();
    expect(retireButton).toBeDisabled();

    resolveRetire?.();
    await waitFor(() => expect(screen.getByRole('button', { name: '無効ON' })).not.toBeDisabled());
  });

  it('debounces one drawing-name digit query and sends it to both server lists', async () => {
    renderPage();
    await screen.findAllByText('図面71-A61');
    apiMocks.listTemplates.mockClear();
    apiMocks.listVisuals.mockClear();

    const keypad = screen.getByRole('group', { name: '図面名数字テンキー' });
    for (const digit of ['7', '1', '6', '1']) {
      fireEvent.click(within(keypad).getByRole('button', { name: digit, exact: true }));
    }

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    });

    await waitFor(() =>
      expect(apiMocks.listTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ digitQuery: '7161', fhincd: undefined })
      )
    );
    await waitFor(() =>
      expect(apiMocks.listVisuals).toHaveBeenCalledWith(
        expect.objectContaining({ digitQuery: '7161', limit: 41 }),
        undefined
      )
    );
  });
});
