import clsx from 'clsx';

import { Dialog } from '../../../components/ui/Dialog';

import { NfcPrompt, kioskButtonClass } from './reductionUi';
import { CHANGE_POINT_KINDS, CHANGE_POINT_KIND_LABELS, REDUCTION_PROCESS_LABELS } from './selfInspectionReductionViewModel';

import type { SelfInspectionChangePointKind, SelfInspectionReductionPart } from '../../../api/client';

function formatDate(iso: string) {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 変化点の種類を選び、記録する人の社員タグで確定する。 */
export function ReductionChangePointDialog({
  part,
  selectedKind,
  pending,
  message,
  onSelectKind,
  onClose
}: {
  part: SelfInspectionReductionPart | null;
  selectedKind: SelfInspectionChangePointKind | null;
  pending: boolean;
  message: string | null;
  onSelectKind: (kind: SelfInspectionChangePointKind | null) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      isOpen={part != null}
      onClose={onClose}
      title="変化点を記録"
      closeOnEsc={!pending}
      closeOnBackdrop={!pending}
      size="lg"
      className="!my-auto !max-w-[600px] !rounded-xl !border !border-[#2f4159] !bg-[#111b28] !p-6 !text-[#e8eef6] !shadow-2xl"
      titleClassName="text-2xl font-black"
    >
      {part ? (
        <div className="mt-4 grid gap-3.5">
          <p className="text-[15px] font-bold text-[#aab8ca]">
            {part.key.fhincd}{'\u3000'}{REDUCTION_PROCESS_LABELS[part.key.processGroup]}{'\u3000'}資源 {part.key.resourceCd}
            {part.machineName ? `\u3000${part.machineName}` : ''}
          </p>
          <div role="group" aria-label="変化点の種類" className="flex flex-wrap gap-2">
            {CHANGE_POINT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={selectedKind === kind}
                disabled={pending}
                onClick={() => onSelectKind(selectedKind === kind ? null : kind)}
                className={clsx(
                  'h-11 rounded-lg border px-3.5 text-[15px] font-bold',
                  selectedKind === kind ? 'border-amber-300 bg-[#3a2f12] text-amber-200' : 'border-[#2f4159] bg-[#0a111a] hover:border-amber-300'
                )}
              >
                {CHANGE_POINT_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          {selectedKind ? <NfcPrompt>{pending ? '記録中…' : '記録する人の社員タグをタッチ'}</NfcPrompt> : null}
          {message ? (
            <p role="alert" className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
              {message}
            </p>
          ) : null}
          <section className="grid gap-1.5 rounded-xl border border-[#243347] bg-[#141e2b] px-4 py-3">
            <h3 className="text-[15px] font-bold text-[#aab8ca]">これまでの変化点</h3>
            {part.changePoints.length === 0 ? <p className="text-[#72849b]">なし</p> : null}
            {[...part.changePoints].reverse().map((point) => (
              <p key={point.id} className="flex h-10 items-center gap-3 border-b border-[#1f2d3f] text-[15px] last:border-b-0">
                <span className="font-mono text-[#aab8ca]">{formatDate(point.occurredAt)}</span>
                <b>{CHANGE_POINT_KIND_LABELS[point.kind]}</b>
                <span className="ml-auto text-sm text-[#72849b]">{point.recordedByName}</span>
              </p>
            ))}
          </section>
          <div className="flex justify-end">
            <button type="button" className={kioskButtonClass} disabled={pending} onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
