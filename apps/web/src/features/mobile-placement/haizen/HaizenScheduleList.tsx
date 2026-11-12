import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useScheduleSeibans } from '../../../api/hooks/schedule-seibans';
import { normalizeMachineName } from '../../kiosk/productionSchedule/machineName';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { HaizenHeader } from './HaizenHeader';
import { HaizenScheduleDropdown } from './HaizenScheduleDropdown';
import { formatScheduleDate, scheduleDateColor, scheduleDetailPath, scheduleStateColors } from './scheduleDisplay';
import { useHaizenScheduleView } from './useHaizenScheduleView';

import type { SchedulePartState } from '../../../api/domains/schedule-seibans';

export function HaizenScheduleList() {
  const navigate = useNavigate();
  const { view, changeView } = useHaizenScheduleView();
  const query = useScheduleSeibans(view);
  const [incomplete, setIncomplete] = useState(false);
  const rows = (query.data?.seibans ?? []).filter(row => !incomplete || row.counts.pending + row.counts.verified > 0);
  return <section style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <HaizenHeader title="日程" onBack={() => navigate('/kiosk/mobile-placement')} />
      <div className="flex max-w-full shrink-0 flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] px-3.5 pb-1 pt-3" role="group" aria-label="製番の絞り込み">
        <HaizenScheduleDropdown ariaLabel="区分" value={view.source}
          options={[{ value: 'general', label: '一般' }, { value: 'dCompany', label: 'D社' }, { value: 'both', label: '両方' }]}
          closedLabel={{ both: '一般・D社', general: '一般', dCompany: 'D社' }[view.source]}
          onChange={source => changeView({ ...view, source })} />
        <HaizenScheduleDropdown ariaLabel="範囲" value={view.range}
          options={[{ value: 'aroundMonth', label: '前後1ヶ月' }, { value: 'all', label: '全期間' }, { value: 'excludeOlderThanHalfYear', label: '半年より前は除外' }]}
          closedLabel={{ aroundMonth: '前後1ヶ月', all: '全期間', excludeOlderThanHalfYear: '半年より前は除外' }[view.range]}
          onChange={range => changeView({ ...view, range })} />
        {([false, true] as const).map(value => <button type="button" key={String(value)} aria-pressed={incomplete === value} className={`${hp.segment} !px-2.5 !text-[14px]`} onClick={() => setIncomplete(value)}>{value ? '揃っていない' : 'すべて'}</button>)}
      </div>
      {query.isError && <p role="alert" className="px-3.5 text-[var(--hp-ng)]">日程を取得できません</p>}
      <div className={`${hp.list} !pt-2 ${hp.hermesBottomPadding}`}>
        {rows.map(row => {
          const unfinished = row.counts.shelf + row.counts.verified + row.counts.pending;
          const total = unfinished + row.counts.done;
          return <button type="button" key={row.fseiban} onClick={() => navigate(scheduleDetailPath(row.fseiban))} className="flex shrink-0 flex-col gap-1.5 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3.5 py-3 text-left">
            <div className="flex items-center gap-2.5">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <time dateTime={row.partsCompleteDate ?? undefined} className="shrink-0 whitespace-nowrap text-[16px] font-extrabold tabular-nums" style={{ color: scheduleDateColor(row.partsCompleteDate) }}>{formatScheduleDate(row.partsCompleteDate)}</time>
                <strong className="truncate font-mono text-[22px] font-extrabold">{row.fseiban}</strong>
              </div>
              <div role="img" aria-label={`棚にある ${row.counts.shelf}、照合済み ${row.counts.verified}、まだ ${row.counts.pending}、完了 ${row.counts.done}`} className={`flex h-1.5 min-w-6 flex-1 overflow-hidden rounded-[3px] bg-[var(--hp-line)] ${total ? '' : 'invisible'}`}>
                {(['shelf', 'verified', 'pending', 'done'] as SchedulePartState[]).map(state => <span key={state} style={{ width: `${total ? row.counts[state] / total * 100 : 0}%`, backgroundColor: scheduleStateColors[state] }} />)}
              </div>
              <span className={`shrink-0 font-mono text-[14px] ${hp.muted}`}>{row.counts.shelf}/{unfinished}</span>
            </div>
            <div className="flex min-w-0 items-baseline gap-2.5 text-[13px]">
              {row.machineName && <span className="min-w-0 truncate text-[var(--hp-ink3)]">{normalizeMachineName(row.machineName)}</span>}
              {(row.sendOutDate || row.outsourceMarks.length > 0) && <span className={`ml-auto shrink-0 whitespace-nowrap ${hp.muted}`}>{row.sendOutDate && <>★ {formatScheduleDate(row.sendOutDate)} </>}{row.outsourceMarks.length > 0 && `(${row.outsourceMarks.join('')})`}</span>}
            </div>
          </button>;
        })}
        {rows.length === 0 && !query.isError && <p className={hp.empty}>{query.isPending ? '読込中…' : '日程はありません'}</p>}
        {query.data?.truncated && <p className={`text-center text-sm ${hp.muted}`}>200件まで表示</p>}
      </div>
    </div>
  </section>;
}
