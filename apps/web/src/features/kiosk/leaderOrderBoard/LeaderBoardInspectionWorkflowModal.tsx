import clsx from 'clsx';

import { Dialog } from '../../../components/ui/Dialog';

import { presentLeaderOrderRow } from './leaderOrderRowPresentation';

import type { LeaderBoardRow } from './types';

type Props = {
  row: LeaderBoardRow | null;
  onClose: () => void;
  onOpenDigitalInput: (row: LeaderBoardRow) => void;
  onOpenPaperPrint: (row: LeaderBoardRow) => void;
};

export function LeaderBoardInspectionWorkflowModal({
  row,
  onClose,
  onOpenDigitalInput,
  onOpenPaperPrint
}: Props) {
  const pres = row ? presentLeaderOrderRow(row) : null;
  const canOpenDigitalInput = Boolean(row?.selfInspectionEntryPath?.trim());
  const canOpenPaperPrint = Boolean(row?.selfInspectionTemplateId?.trim());

  return (
    <Dialog
      isOpen={row != null}
      onClose={onClose}
      title="検査方法を選択"
      size="sm"
      className="border-2 border-slate-950 bg-white text-slate-950 shadow-2xl"
      titleClassName="text-base font-bold text-slate-950"
      overlayZIndex={90}
    >
      {row && pres ? (
        <div className="mt-3 space-y-4">
          <div className="space-y-1 border-y border-slate-300 py-3 text-xs text-slate-800">
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-slate-600">資源</span>
              <span className="font-mono font-bold text-slate-950">{row.resourceCd}</span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-slate-600">部品</span>
              <span className="min-w-0 truncate font-semibold text-slate-950">
                {row.fhincd.trim() || '—'}
                {pres.partNameLine ? ` / ${pres.partNameLine}` : ''}
              </span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-slate-600">製番</span>
              <span className="min-w-0 truncate font-mono font-bold text-slate-950">{row.fseiban.trim() || '—'}</span>
            </div>
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              disabled={!canOpenDigitalInput}
              onClick={() => onOpenDigitalInput(row)}
              className={clsx(
                'rounded border px-4 py-3 text-left text-sm font-semibold transition-colors',
                canOpenDigitalInput
                  ? 'border-sky-900 bg-sky-700 text-white shadow hover:bg-sky-800'
                  : 'cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400'
              )}
            >
              デジタル入力
            </button>
            <button
              type="button"
              disabled={!canOpenPaperPrint}
              onClick={() => onOpenPaperPrint(row)}
              className={clsx(
                'rounded border px-4 py-3 text-left text-sm font-semibold transition-colors',
                canOpenPaperPrint
                  ? 'border-emerald-900 bg-emerald-700 text-white shadow hover:bg-emerald-800'
                  : 'cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400'
              )}
            >
              帳票紙印刷
            </button>
          </div>

          <div className="flex justify-end border-t border-slate-300 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-slate-100"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
