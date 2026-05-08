import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompositeLeaderboardPhasedScheduleWithAutoAppend } from '../useCompositeLeaderboardPhasedScheduleWithAutoAppend';

import type { ProductionScheduleRow } from '../../../../api/client';

const decorationsMock = vi.fn();
const innerHookMock = vi.fn();

vi.mock('../../../../api/hooks', () => ({
  useKioskProductionScheduleLeaderboardDecorations: (...args: unknown[]) => decorationsMock(...args)
}));

vi.mock('../useLeaderboardPhasedScheduleWithAutoAppend', () => ({
  useLeaderboardPhasedScheduleWithAutoAppend: (...args: unknown[]) => innerHookMock(...args)
}));

function row(id: string, resourceCd: string): ProductionScheduleRow {
  return {
    id,
    rowData: { FSIGENCD: resourceCd, ProductNo: id, FSEIBAN: `S-${id}`, FHINCD: `P-${id}` }
  } as unknown as ProductionScheduleRow;
}

describe('useCompositeLeaderboardPhasedScheduleWithAutoAppend', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    decorationsMock.mockReset();
    innerHookMock.mockReset();
    decorationsMock.mockReturnValue({
      data: {
        rowDecorations: [],
        leaderboardFooterChipsByPartKey: {}
      },
      isFetching: false
    });

    innerHookMock.mockImplementation((options: { leaderboardPhasedParams: { resourceCds?: string } }) => {
      if (options.leaderboardPhasedParams.resourceCds === 'R1') {
        return {
          appendError: null,
          scheduleQuery: {
            data: { page: 1, pageSize: 160, total: 3, rows: [row('r1-a', 'R1'), row('r1-b', 'R1')] },
            isLoading: false,
            isError: false,
            isFetching: false
          }
        };
      }
      return {
        appendError: null,
        scheduleQuery: {
          data: { page: 1, pageSize: 160, total: 1, rows: [row('r2-a', 'R2')] },
          isLoading: false,
          isError: false,
          isFetching: false
        }
      };
    });
  });

  it('resource 順で rows を連結し listIncomplete をカード単位で集約する', () => {
    let latest:
      | ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend>
      | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
          leaderboardPhasedBaseParams: {
            allowResourceOnly: true,
            pageSize: 160
          },
          resourceCdsOrdered: ['R1', 'R2'],
          scheduleEnabled: true,
          pauseRefetch: false,
          refetchIntervalMs: 120000,
          macManualOrderV2: false,
          activeDeviceScopeKey: ''
        });
      return <>{latest?.feedMounts}</>;
    }

    render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Harness))
    );

    return waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r2-a']);
      expect(latest?.scheduleQuery.data?.total).toBe(4);
      expect(latest?.listIncomplete).toBe(true);
      expect(latest?.appendError).toBeNull();
      expect(decorationsMock).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ enabled: false })
      );
    });
  });

  it('一部カードの rows が先に来たら全カード完了前でも loading を解除する', () => {
    innerHookMock.mockImplementation((options: { leaderboardPhasedParams: { resourceCds?: string } }) => {
      if (options.leaderboardPhasedParams.resourceCds === 'R1') {
        return {
          appendError: null,
          scheduleQuery: {
            data: { page: 1, pageSize: 160, total: 3, rows: [row('r1-a', 'R1'), row('r1-b', 'R1')] },
            isLoading: false,
            isError: false,
            isFetching: false
          }
        };
      }
      return {
        appendError: null,
        scheduleQuery: {
          data: undefined,
          isLoading: true,
          isError: false,
          isFetching: true
        }
      };
    });

    let latest:
      | ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend>
      | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 160
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: ''
      });
      return <>{latest?.feedMounts}</>;
    }

    render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Harness))
    );

    return waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b']);
      expect(latest?.scheduleQuery.isLoading).toBe(false);
      expect(latest?.scheduleQuery.isFetching).toBe(false);
    });
  });
});
