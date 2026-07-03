import clsx from 'clsx';

import { Dialog } from '../../components/ui/Dialog';
import {
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName
} from '../kiosk/kioskTheme';

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
      className="!rounded-lg !border !border-white/20 !bg-slate-900 !text-white !shadow-none [&_p.text-sm]:!text-white/60"
      titleClassName="text-base font-bold text-white"
      overlayZIndex={90}
    >
      {target ? (
        <div className="mt-3 space-y-4">
          <div className="space-y-1 border-y border-white/15 py-3 text-xs text-white/80">
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-white/55">製造order</span>
              <span className="min-w-0 truncate font-mono font-bold text-white">
                {target.productNo.trim() || '—'}
              </span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-white/55">資源</span>
              <span className="font-mono font-bold text-white">{target.resourceCd.trim() || '—'}</span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-white/55">部品</span>
              <span className="min-w-0 truncate font-semibold text-white">
                {target.fhincd.trim() || '—'}
                {target.fhinmei.trim() ? ` / ${target.fhinmei.trim()}` : ''}
              </span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="shrink-0 font-semibold text-white/55">製番</span>
              <span className="min-w-0 truncate font-mono font-bold text-white">
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
                'rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors',
                canOpenDigitalInput
                  ? kioskButtonPrimaryClassName
                  : clsx(kioskButtonSecondaryClassName, 'cursor-not-allowed opacity-40')
              )}
            >
              デジタル入力
            </button>
            <button
              type="button"
              disabled={!canOpenPaperPrint}
              onClick={() => onOpenPaperPrint(target)}
              className={clsx(
                'rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors',
                canOpenPaperPrint
                  ? kioskButtonPrimaryClassName
                  : clsx(kioskButtonSecondaryClassName, 'cursor-not-allowed opacity-40')
              )}
            >
              帳票紙印刷
            </button>
          </div>

          <div className="flex justify-end border-t border-white/15 pt-3">
            <button
              type="button"
              onClick={onClose}
              className={clsx(kioskButtonSecondaryClassName, 'px-3 py-2 text-xs')}
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
