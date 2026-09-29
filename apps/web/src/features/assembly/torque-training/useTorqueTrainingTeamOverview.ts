import { useCallback, useEffect, useRef, useState } from 'react';

import { getTorqueTrainingTeamOverview, type TorqueTrainingTeamOverviewApi } from '../../../api/client';

/** 別端末の訓練完了も拾うため、キオスクでは1分ごとに読み直す。 */
export const TEAM_OVERVIEW_REFRESH_MS = 60_000;

/**
 * 全員分の訓練KPIを取得する。失敗しても訓練操作は止めず、
 * 直前の値（初回は空）を表示し続ける。
 */
export function useTorqueTrainingTeamOverview(refreshMs = TEAM_OVERVIEW_REFRESH_MS) {
  const [overview, setOverview] = useState<TorqueTrainingTeamOverviewApi | null>(null);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    try {
      const next = await getTorqueTrainingTeamOverview();
      if (generation === generationRef.current) setOverview(next);
    } catch {
      // KPIは補助表示のため、取得失敗で訓練画面のエラー表示を上書きしない。
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh, refreshMs]);

  return { overview, refresh };
}
