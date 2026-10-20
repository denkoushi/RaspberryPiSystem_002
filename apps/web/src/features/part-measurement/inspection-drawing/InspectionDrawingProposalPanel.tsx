import clsx from 'clsx';

import type { DrawingProposalTab, InspectionDrawingPlacementProposals } from './useInspectionDrawingPlacementProposals';
import type { DrawingPlacementRow } from '../../../api/domains/part-measurement-placement';
import type { ReactNode } from 'react';

type Props = {
  placement: Pick<InspectionDrawingPlacementProposals,
    'proposals' | 'unplaced' | 'sourceDrawingName' | 'selectedProposalId' | 'armedId' |
    'tab' | 'setTab' | 'selectProposal' | 'approve' | 'approveAll' | 'reject' | 'arm'>;
  confirmedCount: number;
  disabled?: boolean;
  children: ReactNode;
};

const circleClass = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] border-dashed border-[#d97706] bg-amber-100 font-bold text-amber-900';
const formatNominal = (row: DrawingPlacementRow) => row.nominalValue.toFixed(row.decimalPlaces);

export function InspectionDrawingProposalLegend() {
  return (
    <div className="flex shrink-0 items-center gap-5 py-1 text-sm text-slate-200">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-5 w-5 rounded-full border-[3px] border-dashed border-[#d97706] bg-amber-100" />
        AI案（検査に使えない）
      </span>
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-solid border-slate-200" />
        確定
      </span>
    </div>
  );
}

export function InspectionDrawingProposalPanel({ placement, confirmedCount, disabled = false, children }: Props) {
  const { proposals, unplaced, tab } = placement;
  if (!proposals.length && !unplaced.length) return <>{children}</>;
  const tabs: { id: DrawingProposalTab; label: string; count: number }[] = [
    { id: 'proposals', label: 'AI案', count: proposals.length },
    { id: 'unplaced', label: '未配置', count: unplaced.length },
    { id: 'confirmed', label: '確定', count: confirmedCount }
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-slate-100">
      <div className="grid shrink-0 grid-cols-3 gap-1 rounded-lg bg-slate-900 p-1" role="group" aria-label="測定点の種類">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            className={clsx('min-h-11 rounded-md px-2 font-bold', tab === id ? 'bg-slate-600 text-white' : 'text-slate-200')}
            onClick={() => placement.setTab(id)}
          >
            {label} {count}
          </button>
        ))}
      </div>
      {tab === 'confirmed' ? children : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1" aria-label={tab === 'proposals' ? 'AI案' : '未配置'}>
            {tab === 'proposals' ? proposals.map((row) => (
              <li key={row.id} className={clsx(
                'flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 p-2',
                placement.selectedProposalId === row.id && 'ring-2 ring-blue-400'
              )}>
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                  aria-label={`AI案 ${row.markerNo} ${row.measurementLabel} を選択`}
                  onClick={() => placement.selectProposal(row.id)}
                >
                  <span className={circleClass}>{row.markerNo}</span>
                  <span className="min-w-0">
                    <span className="block font-bold">{row.measurementLabel} {row.dimensionText || formatNominal(row)}</span>
                    <span className="block truncate text-sm text-slate-200" title={placement.sourceDrawingName ?? undefined}>
                      {row.lowerLimit ?? '—'}〜{row.upperLimit ?? '—'}・元 {placement.sourceDrawingName ?? '—'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`AI案 ${row.markerNo} を却下`}
                  disabled={disabled}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-500 text-slate-100 disabled:opacity-50"
                  onClick={() => placement.reject(row)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={`AI案 ${row.markerNo} を承認`}
                  disabled={disabled}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white disabled:opacity-50"
                  onClick={() => placement.approve(row)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                </button>
              </li>
            )) : unplaced.map((row) => (
              <li key={row.id} className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 p-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] border-dotted border-amber-400 font-bold text-amber-200">?</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{row.measurementLabel} {formatNominal(row)}</p>
                  <p className="text-sm text-slate-200">同じ値が図面に見つからない</p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`${row.measurementLabel} を置く`}
                  aria-pressed={placement.armedId === row.id}
                  className={clsx('min-h-11 shrink-0 rounded-md border border-amber-400 px-3 font-bold disabled:opacity-50',
                    placement.armedId === row.id ? 'bg-amber-200 text-amber-950' : 'text-amber-200')}
                  onClick={() => placement.arm(row)}
                >
                  {placement.armedId === row.id ? '配置待ち' : '置く'}
                </button>
              </li>
            ))}
          </ul>
          {tab === 'proposals' && proposals.length > 0 ? (
            <button
              type="button"
              disabled={disabled}
              className="min-h-11 w-full shrink-0 rounded-lg border-2 border-amber-400 font-bold text-amber-200 disabled:opacity-50"
              onClick={placement.approveAll}
            >
              まとめて承認（{proposals.length}）
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
