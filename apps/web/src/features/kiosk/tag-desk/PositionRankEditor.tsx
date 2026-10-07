import { Fragment, useRef, useState } from 'react';

import { adjacentRank, changedPositions, movePosition, POSITION_RUNGS, positionRanksPayload, positionsOnRank, rankSummary } from './positionRankModel';
import { PositionRankRung } from './PositionRankRung';
import { tagDesk } from './tagDeskTheme';

import type { PositionRankRow } from './positionRankModel';
import type { KnowledgePositionRank, KnowledgePositionRanksRequest } from '@raspi-system/shared-types';

export function PositionRankEditor({ initialRows, employeeTotal, onSave, onBack }: {
  initialRows: PositionRankRow[]; employeeTotal: number;
  onSave: (body: KnowledgePositionRanksRequest) => Promise<void>; onBack: () => void;
}) {
  const [savedRows, setSavedRows] = useState(initialRows);
  const [rows, setRows] = useState(initialRows);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBack, setConfirmBack] = useState(false);
  const focusAfterMove = useRef<string | null>(null);
  const changes = changedPositions(rows, savedRows);
  const summary = rankSummary(rows, employeeTotal);
  const unset = positionsOnRank(rows, null);

  const move = (name: string, rank: KnowledgePositionRank, keepFocus = false) => {
    if (busy || !rows.some(row => row.positionName === name)) return;
    focusAfterMove.current = keepFocus ? name : null;
    setRows(current => movePosition(current, name, rank));
    setPicked(keepFocus ? name : null);
    setNotice(null); setError(null);
  };
  const rungProps = {
    picked, changed: changes, busy, onMove: move,
    onPick: (name: string) => setPicked(current => current === name ? null : name),
    onArrow: (row: PositionRankRow, key: 'ArrowUp' | 'ArrowDown') => {
      const next = adjacentRank(row.rank, key);
      if (next) move(row.positionName, next, true);
    },
    chipRef: (name: string) => (node: HTMLButtonElement | null) => {
      if (node) {
        if (focusAfterMove.current === name) { node.focus(); focusAfterMove.current = null; }
      }
    }
  };
  async function save() {
    setBusy(true); setNotice(null); setError(null);
    try {
      await onSave(positionRanksPayload(rows));
      setSavedRows(rows); setPicked(null); setNotice('保存しました');
    } catch { setError('保存できませんでした'); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="職位の対応表" className={`flex min-h-0 w-full max-w-[1280px] flex-col overflow-hidden text-white ${tagDesk.panel}`}>
      <div className="flex items-center gap-6 px-6 py-4">
        <button type="button" disabled={busy} className={`${tagDesk.btn} ${tagDesk.ghost}`} onClick={() => changes.length ? setConfirmBack(true) : onBack()}>戻る</button>
        <div><h1 className="text-[22px] font-black">職位の対応表</h1><p className={`text-sm ${tagDesk.mute}`}>職位を段に置くと、NFC承認の可否が決まります。</p></div>
        <div className="ml-auto flex gap-6 text-right text-xs">
          <div><strong className="block text-[26px] leading-tight text-[#34d399]">{summary.approvers}<small className="ml-1 text-sm">人</small></strong>承認できる</div>
          <div><strong className="block text-[26px] leading-tight">{summary.nonApprovers}<small className="ml-1 text-sm">人</small></strong>承認できない</div>
          {summary.unsetPositions > 0 ? <div><strong className="block text-[26px] leading-tight text-[#ffb547]">{summary.unsetPositions}<small className="ml-1 text-sm">職位</small></strong>段が未設定</div> : null}
        </div>
      </div>
      {confirmBack ? <div role="alert" className="mx-6 mb-3 flex items-center gap-3 rounded-xl border border-[#765423] bg-[#3a2a12] p-3">
        <span className="flex-1 text-[#ffb547]">未保存の変更があります</span>
        <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} onClick={onBack}>保存せず戻る</button>
        <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} onClick={() => setConfirmBack(false)}>やめる</button>
      </div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3">
        {unset.length > 0 ? <div className="mb-3"><PositionRankRung {...rungProps} rank={null} label="段が未設定" rows={unset} /></div> : null}
        {POSITION_RUNGS.map(rung => <Fragment key={rung.rank}>
          {rung.rank === 'general' ? <div className="my-1 flex items-center gap-3 text-xs font-bold text-[#34d399]"><span className="flex-1 border-t-2 border-dashed border-[#24634e]" />↑ ここから上が承認できる<span className="flex-1 border-t-2 border-dashed border-[#24634e]" /></div> : null}
          <PositionRankRung {...rungProps} {...rung} rows={positionsOnRank(rows, rung.rank)} />
        </Fragment>)}
      </div>
      <div className="flex flex-none items-center gap-3 border-t border-[#223043] bg-[#131c29] px-6 py-3">
        <span className={`text-sm ${tagDesk.mute}`}>{picked ? <><b className={tagDesk.signal}>{picked}</b> を置く段を押す（↑↓キーでも動かせます）</> : '職位をドラッグするか、押してから段を押す'}</span>
        <div className="ml-auto flex items-center gap-3">
          {notice ? <span role="status" className="text-sm font-bold text-[#34d399]">{notice}</span> : null}
          {error ? <span role="alert" className="text-sm text-[#ffb547]">{error}</span> : null}
          <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} disabled={busy || changes.length === 0} onClick={() => { setRows(savedRows); setPicked(null); setNotice(null); setError(null); }}>元に戻す</button>
          <button type="button" className={`${tagDesk.btn} ${tagDesk.go}`} disabled={busy || changes.length === 0} onClick={() => void save()}>{busy ? '保存しています…' : changes.length ? `保存（${changes.length}件）` : '保存'}</button>
        </div>
      </div>
    </section>
  );
}
