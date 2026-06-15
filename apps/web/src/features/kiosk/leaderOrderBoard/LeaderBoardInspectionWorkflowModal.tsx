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
      className="border-white/15 bg-slate-900 text-white"
      titleClassName="text-base font-semibold text-cyan-100"
      overlayZIndex={90}
    >
      {row && pres ? (
        <div className="mt-3 space-y-4">
          <div className="space-y-1 border-y border-white/10 py-3 text-xs text-white/70">
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 text-white/45">資源</span>
              <span className="font-mono text-white/90">{row.resourceCd}</span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 text-white/45">部品</span>
              <span className="min-w-0 truncate text-white/90">
                {row.fhincd.trim() || '—'}
                {pres.partNameLine ? ` / ${pres.partNameLine}` : ''}
              </span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 text-white/45">製番</span>
              <span className="min-w-0 truncate font-mono text-white/90">{row.fseiban.trim() || '—'}</span>
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
                  ? 'border-cyan-300/50 bg-cyan-500/20 text-cyan-50 hover:bg-cyan-500/30'
                  : 'cursor-not-allowed border-white/10 bg-white/5 text-white/35'
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
                  ? 'border-emerald-300/50 bg-emerald-500/20 text-emerald-50 hover:bg-emerald-500/30'
                  : 'cursor-not-allowed border-white/10 bg-white/5 text-white/35'
              )}
            >
              帳票紙印刷
            </button>
          </div>

          <div className="flex justify-end border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-white/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
