import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import { workInstructionMemoNeedsReviewForStep, workInstructionStepKey } from './workInstructionEditorMemo';
import { WorkInstructionMemoReviewIndicator } from './WorkInstructionMemoReviewIndicator';

import type { WorkInstructionEditorController } from './useWorkInstructionEditorController';
import type { WorkInstructionEditorStepDto } from '../../api/domains/work-instruction-overlays';

function StepThumbnail({ step }: { step: WorkInstructionEditorStepDto }) {
  const { blobUrl } = useProtectedImageBlobUrl(step.imageUrl ?? (step.imageAssetId ? `/api/work-instructions/assets/${encodeURIComponent(step.imageAssetId)}` : null));
  return blobUrl ? <img src={blobUrl} alt="" draggable={false} className="h-full w-full object-contain" /> : null;
}

export function WorkInstructionEditorRowsPane({ controller }: { controller: WorkInstructionEditorController }) {
  if (controller.rows.length < 2) return null;
  return <div className="flex shrink-0 items-center gap-1" aria-label="原本の切替">{controller.rows.map((row, index) => <button key={row.rowId} type="button" aria-label={`原本 ${index + 1}`} aria-pressed={row.rowId === controller.selectedRowId} onClick={() => controller.selectRow(row.rowId)} className="flex min-h-11 min-w-11 items-center gap-2 rounded-md px-2.5 text-base hover:bg-[#27313b] aria-pressed:bg-[#27313b] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#5fc3e8]"><span>{row.source.list}</span>{row.updateAvailable ? <span title="新しい原本あり" className="h-2 w-2 rounded-full bg-[#f6b93b]" /> : null}</button>)}</div>;
}

export function WorkInstructionEditorStepsPane({ controller }: { controller: WorkInstructionEditorController }) {
  return <aside className="min-h-0 overflow-y-auto border-r border-[#27313b] bg-[#161c22] px-2 py-2.5" aria-label="手順一覧"><div className="grid justify-items-center gap-2">{controller.activeSteps.map((step, index) => {
    const key = workInstructionStepKey(step);
    const number = step.step || index + 1;
    const memoReview = workInstructionMemoNeedsReviewForStep(key, controller.activeMemoOverridesArray);
    const annotationReview = controller.activeElements.some((element) => (element.stepKey === key || (element.stepKey == null && element.pageIndex === index)) && ['NEEDS_REVIEW', 'UNASSIGNED'].includes(String(element.migrationState).toUpperCase()));
    return <button key={key} type="button" aria-label={`手順 ${number}`} title={`手順 ${number}`} aria-current={key === controller.selectedStepKey ? 'step' : undefined} aria-pressed={key === controller.selectedStepKey} onClick={() => controller.selectStep(key)} className="w-[60px] xl:w-[100px] rounded focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#5fc3e8]"><span className={`relative block aspect-[4/3] w-[60px] xl:w-[100px] overflow-hidden rounded border-2 bg-white ${key === controller.selectedStepKey ? 'border-[#5fc3e8]' : 'border-transparent'}`}><StepThumbnail step={step} /><span className="absolute bottom-1 left-1.5 bg-white px-[3px] font-mono text-sm text-[#333]">{number}</span>{memoReview || annotationReview ? <span className="absolute right-1.5 top-1.5"><WorkInstructionMemoReviewIndicator label={`要確認（手順 ${number}）`} testId={`work-instruction-editor-step-memo-review-${key}`} /></span> : null}</span></button>;
  })}</div></aside>;
}
