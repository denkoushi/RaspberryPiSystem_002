import { ImageOverlayFrame } from '../overlays/ImageOverlayFrame';

import { effectiveWorkInstructionMemo } from './workInstructionEditorMemo';

import type { WorkInstructionEditorRowDto, WorkInstructionEditorStepDto } from '../../api/domains/work-instruction-overlays';
import type { WorkInstructionOverlayAsset } from '../../api/domains/work-instructions';

function stepKey(step: WorkInstructionEditorStepDto): string {
  return step.stepKey || `${step.sourceSystem}:${step.sourceList}:${step.sourceItemId}:${step.step}`;
}

function imageUrl(step: WorkInstructionEditorStepDto | undefined): string | null {
  if (!step) return null;
  return step.imageUrl ?? (step.imageAssetId ? `/api/work-instructions/assets/${encodeURIComponent(step.imageAssetId)}` : null);
}

function VersionPane({
  label,
  version,
  step,
  assets
}: {
  label: string;
  version: string;
  step: WorkInstructionEditorStepDto | undefined;
  assets?: Record<string, WorkInstructionOverlayAsset>;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-[#344252] bg-[#161c22] p-3" aria-label={label}>
      <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 text-sm">
        <span className="truncate text-lg font-bold">{label}</span>
        <span className="shrink-0 text-[#9fadb9]">版 {version}</span>
      </header>
      <div className="min-h-0 min-w-0 flex-1">
        {step ? (
          <ImageOverlayFrame
            imageUrl={imageUrl(step)}
            alt={`${label} 手順${step.step}`}
            overlays={step.overlays ?? []}
            assets={assets}
            className="h-full min-h-0 w-full !bg-[#161c22]"
          />
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center text-xs text-white/50">対応する手順がありません</div>
        )}
      </div>
      <p className="max-h-16 shrink-0 overflow-y-auto break-words text-sm leading-5 text-white/70">{step ? effectiveWorkInstructionMemo(step) : ''}</p>
    </section>
  );
}

/** Shows the public source and the latest imported source in one stable frame. */
export function WorkInstructionVersionComparison({ row, selectedStepKey, assets }: {
  row: WorkInstructionEditorRowDto | null;
  selectedStepKey: string | null;
  assets?: Record<string, WorkInstructionOverlayAsset>;
}) {
  if (!row || !selectedStepKey) return null;
  const published = row.published.steps.find((step) => stepKey(step) === selectedStepKey) ?? row.published.steps.find((step) => step.step === row.latest.steps.find((candidate) => stepKey(candidate) === selectedStepKey)?.step);
  const latest = row.latest.steps.find((step) => stepKey(step) === selectedStepKey) ?? row.latest.steps.find((step) => step.step === published?.step);
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-2 gap-3" data-testid="work-instruction-version-comparison">
      <VersionPane label="公開中" version={String(row.published.revisionNumber)} step={published} assets={row.published.assets} />
      <VersionPane label="新しい原本" version={String(row.latest.revisionNumber)} step={latest} assets={assets} />
    </div>
  );
}
