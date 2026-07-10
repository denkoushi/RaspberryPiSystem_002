import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listKioskInspectionDrawingTemplates } from '../../../../api/client';
import { useInspectionDrawingTemplateLibrary } from '../useInspectionDrawingTemplateLibrary';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../../types';

vi.mock('../../../../api/client', () => ({
  listKioskInspectionDrawingTemplates: vi.fn()
}));

const templateA: KioskInspectionDrawingTemplateSummaryDto = {
  id: 'template-a',
  fhincd: 'ABC-001',
  resourceCd: 'R001',
  processGroup: 'cutting',
  name: 'テンプレA',
  version: 1,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: null,
  visualTemplate: null,
  siblingGroupId: null,
  siblingGroup: null,
  itemCount: 3
};

const templateB: KioskInspectionDrawingTemplateSummaryDto = {
  ...templateA,
  id: 'template-b',
  fhincd: 'XYZ-002',
  resourceCd: 'R002',
  name: 'テンプレB'
};

const listTemplatesMock = vi.mocked(listKioskInspectionDrawingTemplates);

const waitForTemplateSearchDebounce = () => new Promise((resolve) => window.setTimeout(resolve, 430));

describe('useInspectionDrawingTemplateLibrary', () => {
  beforeEach(() => {
    listTemplatesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads templates with default filters on mount', async () => {
    renderHook(() => useInspectionDrawingTemplateLibrary());

    await waitFor(() => {
      expect(listTemplatesMock).toHaveBeenCalledWith({
        includeInactive: false,
        fhincd: undefined,
        visualName: undefined,
        digitQuery: undefined,
        processGroup: undefined,
        resourceCd: undefined
      });
    });
  });

  it('debounces text filters and reloads immediately for select filters', async () => {
    const { result } = renderHook(() => useInspectionDrawingTemplateLibrary());

    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalledTimes(1));

    act(() => result.current.setFhincd('ABC'));
    await act(async () => {
      await waitForTemplateSearchDebounce();
    });
    expect(listTemplatesMock).toHaveBeenCalledTimes(2);
    expect(listTemplatesMock.mock.calls[1][0]).toMatchObject({ fhincd: 'ABC' });

    await act(async () => {
      result.current.setResourceCd('R002');
      await Promise.resolve();
    });
    expect(listTemplatesMock).toHaveBeenCalledTimes(3);
    expect(listTemplatesMock.mock.calls[2][0]).toMatchObject({ fhincd: 'ABC', resourceCd: 'R002' });
  });

  it('resets active filters and reloads default results', async () => {
    const { result } = renderHook(() => useInspectionDrawingTemplateLibrary());

    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      result.current.setVisualName('7161');
      result.current.setIncludeInactive(true);
      await Promise.resolve();
    });
    await act(async () => {
      await waitForTemplateSearchDebounce();
    });
    expect(listTemplatesMock).toHaveBeenCalledTimes(3);
    expect(result.current.hasActiveFilters).toBe(true);

    await act(async () => {
      result.current.resetFilters();
      await Promise.resolve();
    });
    expect(listTemplatesMock.mock.calls.at(-1)?.[0]).toEqual({
      includeInactive: false,
      fhincd: undefined,
      visualName: undefined,
      digitQuery: undefined,
      processGroup: undefined,
      resourceCd: undefined
    });
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('passes the shared menubar digit query and history flag to the server', async () => {
    const { result } = renderHook(() => useInspectionDrawingTemplateLibrary({ digitQuery: '7161' }));

    await waitFor(() =>
      expect(listTemplatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ digitQuery: '7161', includeInactive: false })
      )
    );

    act(() => result.current.setIncludeInactive(true));
    await waitFor(() =>
      expect(listTemplatesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ digitQuery: '7161', includeInactive: true })
      )
    );
  });

  it('reloads the current filters without changing them', async () => {
    const { result } = renderHook(() => useInspectionDrawingTemplateLibrary());

    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalledTimes(1));

    act(() => result.current.setProcessFilter('grinding'));
    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalledTimes(2));

    act(() => result.current.reload());
    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalledTimes(3));
    expect(listTemplatesMock.mock.calls[2][0]).toMatchObject({ processGroup: 'grinding' });
  });

  it('ignores stale responses that arrive after a newer request', async () => {
    const resolvers: Array<(value: KioskInspectionDrawingTemplateSummaryDto[]) => void> = [];
    listTemplatesMock.mockImplementation(
      () =>
        new Promise<KioskInspectionDrawingTemplateSummaryDto[]>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { result } = renderHook(() => useInspectionDrawingTemplateLibrary());

    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalledTimes(1));

    act(() => result.current.setResourceCd('R002'));
    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolvers[1]([templateB]);
    });
    await waitFor(() => expect(result.current.templates).toEqual([templateB]));

    await act(async () => {
      resolvers[0]([templateA]);
    });
    expect(result.current.templates).toEqual([templateB]);
  });
});
