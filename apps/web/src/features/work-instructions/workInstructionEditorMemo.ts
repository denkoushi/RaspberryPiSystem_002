import type {
  WorkInstructionEditorStepDto,
  WorkInstructionMemoOverrideDto,
  WorkInstructionMemoMigrationState,
  WorkInstructionEditRevisionDto
} from '../../api/domains/work-instruction-overlays';

export type WorkInstructionMemoOverrideMap = Record<string, WorkInstructionMemoOverrideDto>;

const MIGRATED: WorkInstructionMemoMigrationState = 'MIGRATED';

function memoText(override: Pick<WorkInstructionMemoOverrideDto, 'text' | 'memo'>): string {
  return typeof override.text === 'string' ? override.text : override.memo ?? '';
}

export function workInstructionMemoOverrideMapKey(
  override: Pick<WorkInstructionMemoOverrideDto, 'stepKey' | 'migratedFromStepKey' | 'migratedFromStep'>,
  fallback = ''
): string {
  return override.stepKey ?? override.migratedFromStepKey ?? (override.migratedFromStep == null ? fallback : String(override.migratedFromStep));
}

export function workInstructionStepKey(step: Pick<WorkInstructionEditorStepDto, 'stepKey' | 'sourceSystem' | 'sourceList' | 'sourceItemId' | 'step'>): string {
  return step.stepKey || `${step.sourceSystem}:${step.sourceList}:${step.sourceItemId}:${step.step}`;
}

export function normalizeMemoMigrationState(
  state: WorkInstructionMemoMigrationState | null | undefined
): WorkInstructionMemoMigrationState | undefined {
  if (!state) return undefined;
  return state.toUpperCase() as WorkInstructionMemoMigrationState;
}

export function memoOverridesToMap(
  overrides: WorkInstructionMemoOverrideDto[] | Record<string, Omit<WorkInstructionMemoOverrideDto, 'stepKey'>> | null | undefined
): WorkInstructionMemoOverrideMap {
  if (!overrides) return {};
  const isArray = Array.isArray(overrides);
  const entries = isArray
    ? overrides.map((override) => [workInstructionMemoOverrideMapKey(override), override] as const)
    : Object.entries(overrides).map(([stepKey, override]) => [stepKey, { ...override, stepKey }] as const);
  return Object.fromEntries(entries.map(([mapKey, override]) => {
    const { memo, text, ...metadata } = override;
    return [mapKey, {
      ...metadata,
      stepKey: isArray ? override.stepKey ?? null : mapKey,
      text: typeof text === 'string' ? text : memo ?? '',
      migrationState: normalizeMemoMigrationState(override.migrationState)
    }];
  })) as WorkInstructionMemoOverrideMap;
}

export function memoOverridesToArray(map: WorkInstructionMemoOverrideMap): WorkInstructionMemoOverrideDto[] {
  return Object.values(map)
    .filter((override) => workInstructionMemoOverrideMapKey(override).trim().length > 0)
    .sort((left, right) => workInstructionMemoOverrideMapKey(left).localeCompare(workInstructionMemoOverrideMapKey(right)))
    .map((override) => {
      const metadata = { ...override };
      delete metadata.memo;
      return { ...metadata, text: memoText(override) };
    });
}

export function workInstructionMemoOverridesSnapshot(map: WorkInstructionMemoOverrideMap): string {
  return JSON.stringify(memoOverridesToArray(map));
}

export function effectiveWorkInstructionMemo(
  step: Pick<WorkInstructionEditorStepDto, 'text' | 'memo' | 'effectiveMemo' | 'memoOverride' | 'stepKey' | 'sourceSystem' | 'sourceList' | 'sourceItemId' | 'step'>,
  overrides?: WorkInstructionMemoOverrideMap
): string {
  const key = workInstructionStepKey(step);
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    const override = overrides[key];
    if (override.action === 'USE_SOURCE' || override.action === 'use-source') return step.text;
    return memoText(override);
  }
  if (typeof step.effectiveMemo === 'string') return step.effectiveMemo;
  if (typeof step.memoOverride === 'string') return step.memoOverride;
  if (typeof step.memo === 'string') return step.memo;
  return step.text;
}

export function memoOverrideForStep(
  step: WorkInstructionEditorStepDto,
  overrides: WorkInstructionMemoOverrideMap
): WorkInstructionMemoOverrideDto | null {
  const override = overrides[workInstructionStepKey(step)];
  return override?.action === 'USE_SOURCE' || override?.action === 'use-source' ? null : override ?? null;
}

export function updateWorkInstructionMemo(
  overrides: WorkInstructionMemoOverrideMap,
  step: WorkInstructionEditorStepDto,
  memo: string
): WorkInstructionMemoOverrideMap {
  const stepKey = workInstructionStepKey(step);
  const current = overrides[stepKey];
  return {
    ...overrides,
    [stepKey]: {
      stepKey,
      text: memo,
      sourceStep: current?.sourceStep ?? step.step,
      migratedFromStep: current?.migratedFromStep ?? step.step,
      ...(current?.baseStepFingerprint ? { baseStepFingerprint: current.baseStepFingerprint } : {}),
      ...(current?.targetStepFingerprint ? { targetStepFingerprint: current.targetStepFingerprint } : {}),
      action: 'AUTO',
      migrationState: current?.migrationState === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : current?.migrationState ?? MIGRATED
    }
  };
}

/** Returning to the source is represented by a USE_SOURCE tombstone until save. */
export function resetWorkInstructionMemo(
  overrides: WorkInstructionMemoOverrideMap,
  step: WorkInstructionEditorStepDto
): WorkInstructionMemoOverrideMap {
  const key = workInstructionStepKey(step);
  if (!Object.prototype.hasOwnProperty.call(overrides, key)) return overrides;
  const current = overrides[key];
  return {
    ...overrides,
    [key]: {
      ...current,
      text: '',
      action: 'USE_SOURCE'
    }
  };
}

/** Explicitly keeping a changed-source memo supplies the target fingerprint. */
export function keepWorkInstructionMemo(
  overrides: WorkInstructionMemoOverrideMap,
  step: WorkInstructionEditorStepDto
): WorkInstructionMemoOverrideMap {
  const stepKey = workInstructionStepKey(step);
  const current = overrides[stepKey];
  if (!current) return overrides;
  return {
    ...overrides,
    [stepKey]: {
      ...current,
      action: 'KEEP',
      ...(current.targetStepFingerprint ? { expectedTargetStepFingerprint: current.targetStepFingerprint } : {}),
      migrationState: MIGRATED
    }
  };
}

export function memoOverrideNeedsReview(override: WorkInstructionMemoOverrideDto | null | undefined): boolean {
  return normalizeMemoMigrationState(override?.migrationState) === 'NEEDS_REVIEW';
}

export function revisionMemoOverrides(revision: WorkInstructionEditRevisionDto | null | undefined): WorkInstructionMemoOverrideMap {
  return memoOverridesToMap(revision?.memoOverrides);
}
