import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useScheduleSeibans } from '../../../api/hooks/schedule-seibans';
import { normalizeMachineName } from '../../kiosk/productionSchedule/machineName';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { HaizenHeader } from './HaizenHeader';
import { formatScheduleDate, scheduleDateColor, scheduleDetailPath, scheduleStateColors } from './scheduleDisplay';

import type { SchedulePartState } from '../../../api/domains/schedule-seibans';

export function HaizenScheduleList() {
  const navigate = useNavigate();
  const query = useScheduleSeibans();
  const [incomplete, setIncomplete] = useState(false);
  const rows = (query.data?.seibans ?? []).filter(row => !incomplete || row.counts.pending + row.counts.verified > 0);
  return <section style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <HaizenHeader title="日程" onBack={() => navigate('/kiosk/mobile-placement')} />
      <div className="flex gap-2 px-3.5 py-3" role="group" aria-label="製番の絞り込み">
        {([false, true] as const).map(value => <button type="button" key={String(value)} aria-pressed={incomplete === value} className={hp.segment} onClick={() => setIncomplete(value)}>{value ? '揃っていない' : 'すべて'}</button>)}
      </div>
      {query.isError && <p role="alert" className="px-3.5 text-[var(--hp-ng)]">日程を取得できません</p>}
      <div className={`${hp.list} ${hp.hermesBottomPadding}`}>
        {rows.map(row => {
          const unfinished = row.counts.shelf + row.counts.verified + row.counts.pending;
          const total = unfinished + row.counts.done;
          return <button type="button" key={row.fseiban} onClick={() => navigate(scheduleDetailPath(row.fseiban))} className="rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-panel)] p-3.5 text-left">
            <div className="flex items-baseline justify-between gap-2"><time dateTime={row.partsCompleteDate ?? undefined} className="text-xl font-black" style={{ color: scheduleDateColor(row.partsCompleteDate) }}>{formatScheduleDate(row.partsCompleteDate)}</time><span className="font-mono text-lg font-bold">{row.counts.shelf}/{unfinished}</span></div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2"><strong className="break-all font-mono text-2xl">{row.fseiban}</strong>{row.machineName && <span className={hp.muted}>{normalizeMachineName(row.machineName)}</span>}</div>
            {(row.sendOutDate || row.outsourceMarks.length > 0) && <div className={`mt-1 ${hp.muted}`}>{row.sendOutDate && <>★ {formatScheduleDate(row.sendOutDate)} </>}{row.outsourceMarks.length > 0 && `(${row.outsourceMarks.join('')})`}</div>}
            <div role="img" aria-label={`棚にある ${row.counts.shelf}、照合済み ${row.counts.verified}、まだ ${row.counts.pending}、完了 ${row.counts.done}`} className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--hp-line)]">
              {(['shelf', 'verified', 'pending', 'done'] as SchedulePartState[]).map(state => <span key={state} style={{ width: `${total ? row.counts[state] / total * 100 : 0}%`, backgroundColor: scheduleStateColors[state] }} />)}
            </div>
          </button>;
        })}
        {rows.length === 0 && !query.isError && <p className={hp.empty}>{query.isPending ? '読込中…' : '日程はありません'}</p>}
        {query.data?.truncated && <p className={`text-center text-sm ${hp.muted}`}>200件まで表示</p>}
      </div>
    </div>
  </section>;
}
