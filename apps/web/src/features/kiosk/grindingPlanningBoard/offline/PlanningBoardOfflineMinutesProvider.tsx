import { useMemo } from 'react';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { useOfflineDScheduleMinutes } from './planningBoardOfflineQueries';

import type { ReactNode } from 'react';

export function PlanningBoardOfflineMinutesProvider({ dueSource, children }: { dueSource: 'excel' | 'scaw'; children: ReactNode }) {
  const query = useOfflineDScheduleMinutes();
  const value = useMemo(() => ({ dueSource, rows: new Map(query.data?.rows.map((row) => [row.fseiban, row])) }), [dueSource, query.data]);
  return <DScheduleMinutesContext.Provider value={value}>{children}</DScheduleMinutesContext.Provider>;
}
