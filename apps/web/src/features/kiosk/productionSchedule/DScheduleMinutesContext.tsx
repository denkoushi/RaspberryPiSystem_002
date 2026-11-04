import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useKioskDScheduleMinutes, type DScheduleMinutesExtras } from '../../../api/hooks/production-schedule/d-schedule-minutes';

export type BoardDueSource = 'excel' | 'scaw';
export const DScheduleMinutesContext = createContext<{ dueSource: BoardDueSource; rows: ReadonlyMap<string, DScheduleMinutesExtras> }>({ dueSource: 'excel', rows: new Map() });

export function DScheduleMinutesProvider({ dueSource, children }: { dueSource: BoardDueSource; children: ReactNode }) {
  const query = useKioskDScheduleMinutes();
  const value = useMemo(() => ({ dueSource, rows: new Map(query.data?.rows.map((row) => [row.fseiban, row])) }), [dueSource, query.data]);
  return <DScheduleMinutesContext.Provider value={value}>{children}</DScheduleMinutesContext.Provider>;
}

export function useDScheduleMinutesExtras(fseiban: string) {
  const { dueSource, rows } = useContext(DScheduleMinutesContext);
  return { extras: rows.get(fseiban), dueSource };
}

export function DScheduleMinutesChips({ extras, dueSource, large = false }: { extras: DScheduleMinutesExtras; dueSource: BoardDueSource; large?: boolean }) {
  return <>
    {dueSource === 'excel' && extras.outsourceMarks.length > 0 && <span className="font-mono font-bold text-amber-300">({extras.outsourceMarks.join('')})</span>}
    {extras.surfaceSendOutDates.map(({ date, note }, index) => <span key={`${date}:${index}`} className={`rounded bg-violet-500/25 px-1 font-mono ${large ? 'text-[13px]' : 'text-[10px]'} font-bold text-violet-100`}>
      ★{Number(date.slice(5, 7))}/{Number(date.slice(8, 10))}{note && <span className="font-sans font-normal text-violet-200/80">{note}</span>}
    </span>)}
  </>;
}
