import { useState } from 'react';

import { Button } from '../../components/ui/Button';

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
      className="grid min-w-0 gap-2 rounded border border-amber-300/40 bg-amber-300/10 p-2"
      aria-label="未割当メモレビュー"
      data-testid="work-instruction-memo-review-list"
    >
      <div>
        <h2 className="text-sm font-bold text-amber-100">未割当メモ</h2>
        <p className="mt-1 text-xs text-amber-100/80">移植先を選んでKEEPするか、原本のメモへ戻してください。</p>
      </div>
      <div className="grid min-w-0 gap-2">
        {pending.map((override, index) => {
          const overrideKey = workInstructionMemoOverrideMapKey(override, String(index));
          const selectedTarget = selectedTargets[overrideKey] ?? '';
          const selectedStep = steps.find((step) => step.stepKey === selectedTarget);
          const canKeep = Boolean(selectedTarget && !occupiedStepKeys.has(selectedTarget) && selectedStep?.memoFingerprint);
          return (
            <article key={overrideKey} className="grid min-w-0 gap-2 rounded border border-white/10 bg-slate-950/50 p-2 text-xs">
              <p className="break-words text-white/80">
                元手順: {override.migratedFromStepKey ?? override.migratedFromStep ?? '不明'}
              </p>
              <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-white">{overrideText(override)}</p>
              <label className="grid min-w-0 gap-1 text-sm font-semibold text-white">
                移植先手順
                <select
                  aria-label={`未割当メモ${index + 1}の移植先手順`}
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
                  選択先の原本fingerprintを取得できるまでKEEPできません。
                </p>
              ) : null}
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  className="min-h-11 !px-3 text-xs"
                  disabled={disabled || !canKeep}
                  onClick={() => onAssignAndKeep(overrideKey, selectedTarget)}
                >
                  選択先へKEEP
                </Button>
                <Button
                  type="button"
                  variant="ghostOnDark"
                  className="min-h-11 !px-3 text-xs"
                  disabled={disabled}
                  onClick={() => onUseSource(overrideKey)}
                >
                  原本を使用
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
