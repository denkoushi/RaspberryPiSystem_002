import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Dialog } from '../../../components/ui/Dialog';
import { KIOSK_ASSEMBLY_HOME_PATH } from '../assemblyRoutes';

import { CheckSheetCard, CheckSheetNfcPrompt, CheckSheetStrip } from './CheckSheetCard';
import { CheckSheetPaper } from './CheckSheetPaper';
import { canComplete, familyName, stageScale } from './checkSheetState';
import { useCheckSheet } from './useCheckSheet';
import './checkSheet.css';

export function CheckSheetScreen({ sheetId }: { sheetId: string }) {
  const [paperOpen, setPaperOpen] = useState(false);
  const state = useCheckSheet(sheetId, paperOpen);
  const { sheet, item, draft, busy } = state;
  const [scale, setScale] = useState(() => stageScale(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const resize = () => setScale(stageScale(window.innerWidth, window.innerHeight));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('resize', resize);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('resize', resize); };
  }, []);
  if (!sheet) return <div className="assembly-check-sheet"><Link to={KIOSK_ASSEMBLY_HOME_PATH}>組立</Link><p role="status">{state.loadError ?? '読込中…'}</p></div>;
  const items = sheet.revision.items;
  const stamps = new Map(sheet.stamps.map((stamp) => [stamp.itemId, stamp]));
  const marks = sheet.stamps.filter((stamp) => stamp.flagged);
  const last = [...sheet.stamps].sort((a, b) => b.stampedAt.localeCompare(a.stampedAt))[0];
  const previous = items.find((entry) => entry.id === (state.previousId ?? last?.itemId) && entry.id !== state.currentId);
  const index = items.findIndex((entry) => entry.id === state.currentId);
  const nexts = items.filter((entry, i) => i > index && !stamps.has(entry.id)).slice(0, 12);
  const ngCount = sheet.stamps.filter((stamp) => stamp.result === 'NG').length;
  const left = items.filter((entry) => !stamps.has(entry.id) || (stamps.get(entry.id)?.result === 'NG' && !stamps.get(entry.id)?.flagged)).length;
  return <div className="assembly-check-sheet">
    <div className="app" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
      <header className="bar">
        <Link className="btn" style={{ display: 'inline-flex', alignItems: 'center' }} to={KIOSK_ASSEMBLY_HOME_PATH}>組立</Link>
        <h1>{sheet.revision.title}</h1><span className="doc num">{sheet.revision.documentNo}{'\u3000'}{sheet.revision.revisionLabel}</span>
        <div className="kv">{([['seiban', '製番'], ['productName', '製品名'], ['shipDate', '出荷予定日']] as const).map(([key, label]) => <span key={key}><b>{label}</b>{sheet.headerValues[key]}</span>)}</div>
        <div className="prog"><span className="prog-num num">{sheet.stamps.length}<small> / {items.length}</small></span><span className="meter"><i className="m-ok" style={{ width: `${(sheet.stamps.length - ngCount) / items.length * 100}%` }} /><i className="m-ng" style={{ width: `${ngCount / items.length * 100}%` }} /></span></div>
        <button type="button" className="btn btn-stop" disabled={busy || sheet.status !== 'IN_PROGRESS'} onClick={() => void state.transition('pause')}>中断</button>
      </header>
      <div className="main">
        <nav className="pane map" aria-label="シート全体"><div className="map-rows" style={{ gridTemplateRows: `repeat(${sheet.revision.groups.length},minmax(0,1fr))` }}>
          {sheet.revision.groups.map((group) => {
            const groupItems = items.filter((entry) => entry.groupId === group.id);
            const done = groupItems.filter((entry) => stamps.has(entry.id)).length;
            return <div className={`mrow ${item?.groupId === group.id ? 'here' : ''} ${done === groupItems.length ? 'all' : done ? 'open' : ''}`} key={group.id}>
              <span className="mno num">{group.groupNo}</span><span className="mname">{group.label}</span><span className="cells">
                {groupItems.map((entry, i) => {
                  const stamp = stamps.get(entry.id);
                  const tone = stamp?.result.toLowerCase() ?? (entry.id === state.currentId ? 'cur' : '');
                  return <span key={entry.id} style={{ display: 'contents' }}>
                    {entry.conditionKey && groupItems[i - 1]?.conditionKey !== entry.conditionKey && <span className="cond-gap" aria-hidden="true" />}
                    <button type="button" disabled={busy} className={`cell ${tone} ${entry.roleKeys.length ? 'role' : ''}`} aria-label={entry.itemKey} onClick={() => state.select(entry.id)}>
                      {stamp ? stamp.result === 'NG' ? '!' : stamp.result === 'NA' ? '' : familyName(stamp.employeeNameSnapshot)[0] : i + 1}
                    </button>
                  </span>;
                })}
              </span>
            </div>;
          })}
        </div></nav>
        <section className="focus" aria-label="今の項目">
          {previous && <CheckSheetStrip item={previous} stamp={stamps.get(previous.id)} previous onSelect={() => state.select(previous.id)} />}
          {item ? <CheckSheetCard item={item} groupLabel={sheet.revision.groups.find((group) => group.id === item.groupId)?.label ?? ''}
            draft={draft} stamp={stamps.get(item.id)} busy={busy} completed={sheet.status === 'COMPLETED'}
            condition={item.conditionKey ? state.conditions[item.conditionKey] : undefined}
            onCondition={(value) => state.setConditions({ ...state.conditions, [item.conditionKey!]: value })} onDraft={state.setDraft} />
            : <div className="card status-card"><div className="q">{sheet.status === 'COMPLETED' ? '完了' : '全項目に印が揃いました'}</div></div>}
          {nexts.length > 0 && <><div className="next-h">次</div><div className="nexts">{nexts.map((entry) => <CheckSheetStrip key={entry.id} item={entry} onSelect={() => state.select(entry.id)} />)}</div></>}
        </section>
        <aside className="side">
          <div className="box"><div className="who"><span className="av">{last ? familyName(last.employeeNameSnapshot)[0] : '—'}</span><span>{last?.employeeNameSnapshot ?? '—'}<small>{last?.positionNameSnapshot ?? '作業者'}</small></span></div></div>
          <div className="box marks"><h3><span className="flag" />目印<span className="c num">{marks.length ? `${marks.length}件` : ''}</span></h3>
            {marks.length ? marks.map((stamp) => {
              const entry = items.find((candidate) => candidate.id === stamp.itemId)!;
              return <button type="button" className="mk" key={stamp.id} onClick={() => state.select(entry.id)}><span className="no num">{entry.itemKey}</span><span className="t">{entry.label}</span><span className="p">{stamp.ngReason}</span></button>;
            }) : <div className="empty">なし</div>}
          </div>
          <div className="box done-box"><button type="button" className="btn" disabled={busy} onClick={() => setPaperOpen(true)}>紙の控え</button>
            <button type="button" className="btn btn-main" disabled={busy || !canComplete(sheet)} onClick={() => void state.transition('complete')}>{sheet.status === 'COMPLETED' ? '完了済み' : '完了'}</button>
            <div className="why num">{left > 0 ? `残り ${left} 項目` : marks.length ? `目印 ${marks.length} 件が残っています` : ''}</div>
          </div>
        </aside>
      </div>
      {state.toast && !state.pendingAction && <div className="toast" role="alert">{state.toast}</div>}
      <Dialog isOpen={!!state.pendingAction} onClose={state.cancelTransition} ariaLabel={state.pendingAction === 'pause' ? '中断' : state.pendingAction === 'resume' ? '再開' : '完了'}
        lockScroll={false} overlayZIndex={1102} overlayClassName="assembly-check-sheet !items-center !bg-black/80" className="!border-0 !bg-transparent !shadow-none !text-white">
        <div className="flex flex-col items-center gap-[18px]">
          <h2 className="text-[28px] font-black">{state.pendingAction === 'pause' ? '中断' : state.pendingAction === 'resume' ? '再開' : '完了'}</h2>
          <CheckSheetNfcPrompt />
          {state.toast && <p role="alert">{state.toast}</p>}
          <button type="button" className="btn" disabled={busy} onClick={state.cancelTransition}>キャンセル</button>
        </div>
      </Dialog>
      <Dialog isOpen={sheet.status === 'PAUSED' && !state.pendingAction && !paperOpen} onClose={() => {}} ariaLabel="中断中" closeOnEsc={false} closeOnBackdrop={false} lockScroll={false}
        overlayZIndex={1101} overlayClassName="!items-center !bg-black/80" className="!border-0 !bg-transparent !shadow-none !text-white">
        <div className="flex flex-col items-center gap-[18px]"><button type="button" className="min-h-11 rounded-md border px-[18px]" onClick={() => setPaperOpen(true)}>紙の控え</button><h2 className="text-[28px] font-black">中断中</h2><p className="text-[18px] text-amber-400">{sheet.pausedReason}</p>
          <button type="button" className="min-h-11 rounded-md border border-cyan-200 bg-cyan-200 px-[18px] font-bold text-cyan-950 disabled:opacity-35" disabled={busy} onClick={() => void state.transition('resume')}>再開</button>
        </div>
      </Dialog>
    </div>
    {paperOpen && <CheckSheetPaper sheetId={sheet.id} onClose={() => setPaperOpen(false)} />}
  </div>;
}
