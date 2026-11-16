import { PlanningBoardConnectivityBanner } from './PlanningBoardConnectivityBanner';
import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { PlanningBoardOfflineContextProvider, usePlanningBoardOffline } from './planningBoardOfflineContext';

import type { BoardOfflineConfig } from './planningBoardOfflineConfig';
import type { ReactNode } from 'react';

export function PlanningBoardOfflineProvider({ children, config = DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG }: {
  children: ReactNode; config?: BoardOfflineConfig;
}) {
  return <PlanningBoardOfflineContextProvider config={config}>
    {children}
    {config.enabled ? <ConnectivityBanner /> : null}
  </PlanningBoardOfflineContextProvider>;
}

function ConnectivityBanner() {
  const { snapshot, displayedAt } = usePlanningBoardOffline();
  return <PlanningBoardConnectivityBanner phase={snapshot.phase} displayedAt={displayedAt} recoveredUntil={snapshot.recoveredUntil} />;
}
