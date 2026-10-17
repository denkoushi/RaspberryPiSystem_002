import { useQuery } from '@tanstack/react-query';

import { LEADER_BOARD_LEADER_PHASED_STALE_MS } from '../../../features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy';
import {
  getKioskProductionScheduleLeaderboardShell,
  getKioskProductionScheduleLeaderboardTotal,
  getKioskProductionScheduleLeaderboardBoard,
  postKioskProductionScheduleLeaderboardDecorations,
  type KioskProductionScheduleLeaderboardPhasedQueryParams,
  type KioskProductionScheduleLeaderboardBoardQueryParams
} from '../../client';

export function useKioskProductionScheduleLeaderboardShell(
  params: KioskProductionScheduleLeaderboardPhasedQueryParams | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-shell', params],
    queryFn: () => getKioskProductionScheduleLeaderboardShell(params),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}

export function useKioskProductionScheduleLeaderboardTotal(
  params: KioskProductionScheduleLeaderboardPhasedQueryParams | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-total', params],
    queryFn: () => getKioskProductionScheduleLeaderboardTotal(params),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}

export function useKioskProductionScheduleLeaderboardDecorations(
  payload:
    | {
        rowIds: string[];
        targetDeviceScopeKey?: string;
      }
    | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);

  const rowFingerprint = payload?.rowIds.length ? payload.rowIds.join('\u0001') : '';

  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-decorations', rowFingerprint, payload?.targetDeviceScopeKey ?? ''],
    queryFn: () =>
      postKioskProductionScheduleLeaderboardDecorations({
        rowIds: payload!.rowIds,
        targetDeviceScopeKey: payload?.targetDeviceScopeKey
      }),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(payload && payload.rowIds.length > 0)
  });
}

/** 順位ボード（多資源スロット）集約 GET。追補は {@link useCompositeLeaderboardPhasedScheduleWithAutoAppend} 内の continue 呼び出し。 */

export function useKioskProductionScheduleLeaderboardBoard(
  params: KioskProductionScheduleLeaderboardBoardQueryParams | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-board', params],
    queryFn: () => getKioskProductionScheduleLeaderboardBoard(params!),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}
