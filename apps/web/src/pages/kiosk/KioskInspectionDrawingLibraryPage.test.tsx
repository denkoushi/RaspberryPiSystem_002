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

  it('keeps retire actions hidden until the page-scoped mode is enabled and preserves mode after success', async () => {
    renderPage();
    await screen.findAllByText('図面71-A61');

    expect(screen.queryByRole('button', { name: '無効', exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '無効ON' }));
    const retireButton = screen.getByRole('button', { name: '無効', exact: true });
    expect(retireButton).toBeInTheDocument();

    apiMocks.confirm.mockReturnValueOnce(false);
    fireEvent.click(retireButton);
    expect(apiMocks.retireTemplate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '無効OFF' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '無効', exact: true }));
    await waitFor(() => expect(apiMocks.retireTemplate).toHaveBeenCalledWith('template-1'));
    await waitFor(() => expect(screen.getByRole('button', { name: '無効OFF' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: '無効', exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '無効OFF' }));
    expect(screen.queryByRole('button', { name: '無効', exact: true })).not.toBeInTheDocument();
  });

  it('locks retire mode and prevents duplicate retire requests while one is pending', async () => {
    let resolveRetire: (() => void) | undefined;
    apiMocks.retireTemplate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRetire = resolve;
        })
    );
    renderPage();
    await screen.findAllByText('図面71-A61');
    fireEvent.click(screen.getByRole('button', { name: '無効ON' }));

    const retireButton = screen.getByRole('button', { name: '無効', exact: true });
    fireEvent.click(retireButton);
    fireEvent.click(retireButton);

    expect(apiMocks.retireTemplate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '無効OFF' })).toBeDisabled();
    expect(retireButton).toBeDisabled();

    resolveRetire?.();
    await waitFor(() => expect(screen.getByRole('button', { name: '無効OFF' })).not.toBeDisabled());
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
