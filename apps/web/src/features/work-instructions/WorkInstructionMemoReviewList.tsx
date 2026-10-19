import { useState } from 'react';

import { WorkInstructionEditorButton as Button } from './WorkInstructionEditorControls';
import { workInstructionMemoOverrideMapKey } from './workInstructionEditorMemo';
import {
  WORK_INSTRUCTION_EDITOR_OPTION_CLASS_NAME,
  WORK_INSTRUCTION_EDITOR_SELECT_CLASS_NAME
} from './workInstructionEditorSelectStyles';

import type {
  WorkInstructionEditorStepDto,
  WorkInstructionMemoOverrideDto
} from '../../api/domains/work-instruction-overlays';

export type WorkInstructionMemoReviewListProps = {
  steps: WorkInstructionEditorStepDto[];
  overrides: WorkInstructionMemoOverrideDto[];
  disabled?: boolean;
  onAssignAndKeep: (overrideKey: string, targetStepKey: string) => void;
  onUseSource: (overrideKey: string) => void;
};

function isUnassigned(override: WorkInstructionMemoOverrideDto): boolean {
  if (override.action === 'USE_SOURCE' || override.action === 'use-source') return false;
  return override.stepKey === null
    || override.sourceStep === null
    || String(override.migrationState ?? '').toUpperCase() === 'UNASSIGNED';
}

function overrideText(override: WorkInstructionMemoOverrideDto): string {
  return typeof override.text === 'string' ? override.text : override.memo ?? '';
}

function isOccupied(override: WorkInstructionMemoOverrideDto): boolean {
  return !isUnassigned(override)
    && override.stepKey !== null
    && override.action !== 'USE_SOURCE'
    && override.action !== 'use-source';
}

export function WorkInstructionMemoReviewList({
  steps,
  overrides,
  disabled = false,
  onAssignAndKeep,
  onUseSource
}: WorkInstructionMemoReviewListProps) {
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const pending = overrides.filter(isUnassigned);
  const occupiedStepKeys = new Set(overrides.filter(isOccupied).map((override) => override.stepKey));

  if (pending.length === 0) return null;

  return (
    <section
      className="grid min-w-0 gap-2"
      aria-label="行き先のないメモ"
      data-testid="work-instruction-memo-review-list"
    >
      <div className="grid min-w-0 gap-2">
        {pending.map((override, index) => {
          const overrideKey = workInstructionMemoOverrideMapKey(override, String(index));
          const selectedTarget = selectedTargets[overrideKey] ?? '';
          const selectedStep = steps.find((step) => step.stepKey === selectedTarget);
          const canKeep = Boolean(selectedTarget && !occupiedStepKeys.has(selectedTarget) && selectedStep?.memoFingerprint);
          return (
            <article key={overrideKey} className="grid min-w-0 gap-2 rounded-lg border border-[#f6b93b] p-3 text-sm">
              <h3 className="text-base font-bold text-[#f6b93b]">行き先のないメモ</h3>
              <p className="break-words text-xs text-[#9fadb9]">
                元の手順 {override.migratedFromStep ?? '不明'}
              </p>
              <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-white">{overrideText(override)}</p>
              <label className="grid min-w-0 gap-1 text-sm font-semibold text-white">
                移し先の手順
                <select
                  aria-label={`行き先のないメモ${index + 1}の移し先の手順`}
                  value={selectedTarget}
                  disabled={disabled}
                  onChange={(event) => setSelectedTargets((current) => ({ ...current, [overrideKey]: event.target.value }))}
                  className={WORK_INSTRUCTION_EDITOR_SELECT_CLASS_NAME}
                >
                  <option className={WORK_INSTRUCTION_EDITOR_OPTION_CLASS_NAME} value="">選択してください</option>
                  {steps.filter((step) => !occupiedStepKeys.has(step.stepKey)).map((step) => (
                    <option key={step.stepKey} className={WORK_INSTRUCTION_EDITOR_OPTION_CLASS_NAME} value={step.stepKey}>
                      手順 {step.step}: {step.text.slice(0, 36)}
                    </option>
                  ))}
                </select>
              </label>
              {selectedTarget && !canKeep ? (
                <p className="break-words text-amber-100" role="alert">
                  この手順へはまだ移せません。
                </p>
              ) : null}
              <div className="flex min-w-0 gap-2">
                <Button
                  type="button"
                  className="min-h-11 !px-3 text-xs"
                  disabled={disabled || !canKeep}
                  onClick={() => onAssignAndKeep(overrideKey, selectedTarget)}
                >
                  ここへ移す
                </Button>
                <Button
                  type="button"
                  className="min-h-11 !px-3 text-xs"
                  disabled={disabled}
                  onClick={() => onUseSource(overrideKey)}
                >
                  原本を使う
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
