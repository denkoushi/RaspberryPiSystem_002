import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useScheduleSeiban } from '../../../api/hooks/schedule-seibans';
import { normalizeMachineName } from '../../kiosk/productionSchedule/machineName';
import { ShelfPhoto } from '../shelfPhoto/ShelfPhoto';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';
import { useRegisteredShelves } from '../useRegisteredShelves';

import { HaizenHeader } from './HaizenHeader';
import { HaizenShelfPhotoViewer } from './HaizenShelfPhotoViewer';
import { formatScheduleDate, scheduleDateColor, scheduleStateColors, scheduleStateLabels, scheduleVerifyPath } from './scheduleDisplay';

import type { SchedulePartState, ScheduleSeibanPart } from '../../../api/domains/schedule-seibans';

export function HaizenScheduleDetail() {
  const { fseiban } = useParams<{ fseiban: string }>();
  const navigate = useNavigate();
  const query = useScheduleSeiban(fseiban);
  const shelves = useRegisteredShelves();
  const [state, setState] = useState<SchedulePartState>('pending');
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);
  const detail = query.data;
  const parts = detail?.parts.filter(part => part.state === state) ?? [];
  const groups = new Map<string, ScheduleSeibanPart[]>();
  for (const part of detail?.parts ?? []) {
    if (part.state !== 'shelf' || !part.shelfCodeRaw) continue;
    groups.set(part.shelfCodeRaw, [...(groups.get(part.shelfCodeRaw) ?? []), part]);
  }
  const shelfFor = (code: string) => shelves.data?.shelves.find(shelf => shelf.shelfCodeRaw === code) ?? { shelfCodeRaw: code, isStructured: false, displayLabel: groups.get(code)?.[0]?.shelfLabel ?? code };
  const selected = selectedShelf ? shelfFor(selectedShelf) : null;
  const partText = (part: ScheduleSeibanPart) => <><span className="break-all font-mono font-bold">{part.fhincd}</span><span className={`block break-words text-sm ${hp.muted}`}>{part.fhinmei}</span></>;
  return <section style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <HaizenHeader title={fseiban ?? '日程'} onBack={() => navigate('/kiosk/mobile-placement/schedule-seibans')} />
      {detail && <>
        <div className="px-3.5 pb-3">
          {detail.aliasFseibans.length > 0 && <p className={`break-all font-mono ${hp.muted}`}>{detail.aliasFseibans.join(' / ')}</p>}
          <div className="flex flex-wrap gap-x-3 text-lg font-bold"><time dateTime={detail.partsCompleteDate ?? undefined} style={{ color: scheduleDateColor(detail.partsCompleteDate) }}>{formatScheduleDate(detail.partsCompleteDate)}</time>{detail.sendOutDate && <span>★ {formatScheduleDate(detail.sendOutDate)}</span>}{detail.outsourceMarks.length > 0 && <span>({detail.outsourceMarks.join('')})</span>}</div>
          {detail.machineName && <p className={hp.muted}>{normalizeMachineName(detail.machineName)}</p>}
          {detail.memo && <p className="mt-1 whitespace-pre-wrap break-words">{detail.memo}</p>}
        </div>
        <div role="group" aria-label="部品の状態" className="grid grid-cols-4 gap-2 px-3.5 pb-3">
          {(['shelf', 'verified', 'pending', 'done'] as const).map(value => <button type="button" key={value} aria-label={`${scheduleStateLabels[value]} ${detail.counts[value]}`} aria-pressed={state === value} className={`${hp.segment} !px-2`} onClick={() => setState(value)}><span aria-hidden className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: scheduleStateColors[value] }} />{detail.counts[value]}</button>)}
        </div>
      </>}
      {query.isError && <p role="alert" className="px-3.5 text-[var(--hp-ng)]">日程を取得できません</p>}
      <div className={`${hp.list} ${hp.hermesBottomPadding}`}>
        {state === 'shelf' ? [...groups].sort((a, b) => b[1].length - a[1].length).map(([code, shelfParts]) => {
          const shelf = shelfFor(code);
          return <button type="button" key={code} className="rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-panel)] p-3 text-left" onClick={() => setSelectedShelf(code)}>
            <div className="flex items-center gap-3"><ShelfPhoto shelf={shelf} label={shelf.displayLabel || code} className="h-20 w-24 shrink-0 rounded-lg" /><strong className="min-w-0 flex-1 break-all text-xl">{shelf.displayLabel || code}</strong><span className="text-xl font-bold">{shelfParts.length}</span></div>
            <div className="mt-2 space-y-2">{shelfParts.slice(0, 3).map(part => <div key={part.productNo}>{partText(part)}</div>)}{shelfParts.length > 3 && <p className={hp.muted}>+{shelfParts.length - 3}</p>}</div>
          </button>;
        }) : parts.map(part => state === 'done'
          ? <div key={part.productNo} className="rounded-xl border border-[var(--hp-line)] p-3.5 opacity-40">{partText(part)}</div>
          : <button type="button" key={part.productNo} className="flex items-center gap-3 rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel)] p-3.5 text-left" onClick={() => navigate(scheduleVerifyPath(detail!.fseiban, part.productNo))}><span className="min-w-0 flex-1">{partText(part)}</span><span aria-hidden className={`text-2xl ${hp.muted}`}>›</span></button>)}
        {!query.isError && (state === 'shelf' ? groups.size === 0 : parts.length === 0) && <p className={hp.empty}>{query.isPending ? '読込中…' : '部品はありません'}</p>}
      </div>
      {detail && detail.counts.pending + detail.counts.verified > 0 && <footer className={hp.dock}><button type="button" className={`${hp.primary} bg-[var(--hp-slip)]`} onClick={() => navigate(scheduleVerifyPath(detail.fseiban))}>照合</button></footer>}
    </div>
    {selected && selectedShelf && <HaizenShelfPhotoViewer shelf={selected} onClose={() => setSelectedShelf(null)}><div className="max-h-[40dvh] shrink-0 overflow-y-auto px-3.5">{groups.get(selectedShelf)?.map(part => <div key={part.productNo} className="border-t border-[var(--hp-line)] py-2">{partText(part)}</div>)}</div></HaizenShelfPhotoViewer>}
  </section>;
}
