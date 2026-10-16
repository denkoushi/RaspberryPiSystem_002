import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { HaizenHeader } from '../../features/mobile-placement/haizen/HaizenHeader';
import { haizenPhoneStyle, hp } from '../../features/mobile-placement/ui/haizenPhoneTokens';
import { useHaizenCurrentPlacements } from '../../features/mobile-placement/useHaizenCurrentPlacements';
import { formatHaizenTime } from '../../features/mobile-placement/zero2w/formatHaizenTime';

export function KioskMobileZero2wStatusPage() {
  const navigate = useNavigate();
  const query = useHaizenCurrentPlacements(undefined);
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const rows = query.data?.rows ?? [];
  const unmatched = rows.filter((row) => row.resolutionNote !== 'RESOLVED');
  const visibleRows = [...(unmatchedOnly ? unmatched : rows)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return <div style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <HaizenHeader title="Zero2W 配膳" onBack={() => navigate('/kiosk/mobile-placement')}>
        <span className={`ml-auto flex items-center gap-1.5 text-[10px] font-bold leading-tight min-[390px]:whitespace-nowrap min-[390px]:text-xs ${hp.faint}`}>
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--hp-ok)]" />自動で更新
        </span>
        <button type="button" aria-label="更新" className={hp.iconButton} disabled={query.isFetching} onClick={() => void query.refetch()}>
          <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></svg>
        </button>
      </HaizenHeader>
      <div className="flex shrink-0 items-center gap-1.5 px-3.5 pb-1.5 pt-2" role="group" aria-label="照合状態">
        <button type="button" className={hp.chip} aria-pressed={!unmatchedOnly} onClick={() => setUnmatchedOnly(false)}>すべて {rows.length}</button>
        <button type="button" className={`${hp.chip} ${unmatched.length ? '!text-[var(--hp-shelf)]' : ''}`} aria-pressed={unmatchedOnly} onClick={() => setUnmatchedOnly(true)}>未照合 {unmatched.length}</button>
        <span className={`ml-auto whitespace-nowrap pl-1.5 text-[13px] font-bold ${hp.faint}`}>新しい順</span>
      </div>
      <section aria-label="Zero2W 棚番配膳の状態" className={`${hp.list} ${hp.hermesBottomPadding}`}>
        {query.isError ? <div role="alert" className={hp.empty}>配膳一覧の取得に失敗しました<br /><button type="button" className={hp.mini} onClick={() => void query.refetch()}>再試行</button></div>
          : query.isLoading ? <p className={hp.empty}>読み込み中…</p>
            : !visibleRows.length ? <p className={hp.empty}>該当する配膳記録はありません。</p> : null}
        <ul className="flex flex-col gap-2">
          {visibleRows.map((row) => <li key={row.id} className="grid shrink-0 grid-cols-[124px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3 py-2.5">
            <span className="row-span-2 whitespace-nowrap font-mono text-base font-bold tracking-[-.02em] text-[var(--hp-shelf)]">{row.shelfCodeRaw}</span>
            <span className="truncate text-[15px] font-black" title={row.fhinmei ?? undefined}>{row.fhinmei}</span>
            <time dateTime={row.updatedAt} className={`whitespace-nowrap text-right text-xs font-bold ${hp.faint}`}>{formatHaizenTime(row.updatedAt)}</time>
            <span className={`truncate font-mono text-xs ${hp.muted}`} title={[row.manufacturingOrderBarcodeRaw, row.fseiban, row.distributionNumber != null ? `分配${row.distributionNumber}` : null].filter(Boolean).join(' · ')}>
              {[row.manufacturingOrderBarcodeRaw, row.fseiban, row.distributionNumber != null ? `分配${row.distributionNumber}` : null].filter(Boolean).join(' · ')}
            </span>
            <span className={`justify-self-end whitespace-nowrap rounded-full border border-current px-2 py-[3px] text-[11px] font-black ${row.resolutionNote === 'RESOLVED' ? 'text-[var(--hp-teal)]' : 'text-[var(--hp-shelf)]'}`}>
              {row.resolutionNote === 'RESOLVED' ? '日程一致' : '未照合'}
            </span>
          </li>)}
        </ul>
      </section>
    </div>
  </div>;
}
