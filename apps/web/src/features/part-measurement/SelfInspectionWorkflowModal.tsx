import clsx from 'clsx';

import { Dialog } from '../../components/ui/Dialog';

export type SelfInspectionWorkflowTarget = {
  productNo: string;
  scheduleRowId: string;
  resourceCd: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  selfInspectionTemplateId: string | null;
  selfInspectionEntryPath: string | null;
};

type Props = {
  target: SelfInspectionWorkflowTarget | null;
  onClose: () => void;
  onOpenDigitalInput: (target: SelfInspectionWorkflowTarget) => void;
  onOpenPaperPrint: (target: SelfInspectionWorkflowTarget) => void;
};

export function SelfInspectionWorkflowModal({
  target,
  onClose,
  onOpenDigitalInput,
  onOpenPaperPrint
}: Props) {
  const canOpenDigitalInput = Boolean(target?.selfInspectionEntryPath?.trim());
  const canOpenPaperPrint = Boolean(target?.selfInspectionTemplateId?.trim());

  return (
    <Dialog
      isOpen={target != null}
      onClose={onClose}
      title="検査方法を選択"
      size="sm"
      className="border-2 border-slate-950 bg-white text-slate-950 shadow-2xl"
      titleClassName="text-base font-bold text-slate-950"
      overlayZIndex={90}
    >
      {target ? (
        <div className="mt-3 space-y-4">
          <div className="space-y-1 border-y border-slate-300 py-3 text-xs text-slate-800">
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-slate-600">製造order</span>
              <span className="min-w-0 truncate font-mono font-bold text-slate-950">
                {target.productNo.trim() || '—'}
              </span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-slate-600">資源</span>
              <span className="font-mono font-bold text-slate-950">{target.resourceCd.trim() || '—'}</span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-slate-600">部品</span>
              <span className="min-w-0 truncate font-semibold text-slate-950">
                {target.fhincd.trim() || '—'}
                {target.fhinmei.trim() ? ` / ${target.fhinmei.trim()}` : ''}
              </span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-slate-600">製番</span>
              <span className="min-w-0 truncate font-mono font-bold text-slate-950">
                {target.fseiban.trim() || '—'}
              </span>
            </div>
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              disabled={!canOpenDigitalInput}
              onClick={() => onOpenDigitalInput(target)}
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
              onClick={() => onOpenPaperPrint(target)}
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
