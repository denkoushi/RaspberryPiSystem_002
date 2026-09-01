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
  override: Pick<WorkInstructionMemoOverrideDto, 'id' | 'stepKey' | 'migratedFromStepKey' | 'migratedFromStep'>,
  fallback = ''
): string {
  const id = typeof override.id === 'string' ? override.id.trim() : '';
  if (id) return id;
  return override.stepKey ?? override.migratedFromStepKey ?? (override.migratedFromStep == null ? fallback : String(override.migratedFromStep));
}

function uniqueMemoOverrideMapKey(preferred: string, used: Set<string>, fallback: string): string {
  const base = preferred.trim() || fallback;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}#${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function nextMemoOverrideMapKey(overrides: WorkInstructionMemoOverrideMap, preferred: string): string {
  return uniqueMemoOverrideMapKey(preferred, new Set(Object.keys(overrides)), `memo:${preferred}`);
}

function memoOverrideEntryForStep(
  overrides: WorkInstructionMemoOverrideMap,
  stepKey: string
): [string, WorkInstructionMemoOverrideDto] | undefined {
  return Object.entries(overrides).find(([, override]) => override.stepKey === stepKey);
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
  const used = new Set<string>();
  const entries = isArray
    ? overrides.map((override, index) => {
        const mapKey = uniqueMemoOverrideMapKey(workInstructionMemoOverrideMapKey(override, `memo:${index}`), used, `memo:${index}`);
        return [mapKey, { ...override, id: mapKey } ] as const;
      })
    : Object.entries(overrides).map(([legacyKey, override], index) => {
        const preferredKey = typeof override.id === 'string' && override.id.trim() ? override.id : legacyKey;
        const mapKey = uniqueMemoOverrideMapKey(preferredKey, used, `memo:${index}`);
        return [mapKey, { ...override, id: mapKey, stepKey: legacyKey }] as const;
      });
  return Object.fromEntries(entries.map(([mapKey, override]) => {
    const { memo, text, ...metadata } = override;
    return [mapKey, {
      ...metadata,
      id: mapKey,
      stepKey: override.stepKey ?? null,
      text: typeof text === 'string' ? text : memo ?? '',
      migrationState: normalizeMemoMigrationState(override.migrationState)
    }];
  })) as WorkInstructionMemoOverrideMap;
}

export function memoOverridesToArray(map: WorkInstructionMemoOverrideMap): WorkInstructionMemoOverrideDto[] {
  return Object.entries(map)
    .filter(([mapKey]) => mapKey.trim().length > 0)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([mapKey, override]) => {
      const metadata = { ...override };
      delete metadata.memo;
      return { ...metadata, id: override.id ?? mapKey, text: memoText(override) };
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
  const entry = overrides ? memoOverrideEntryForStep(overrides, key) : undefined;
  if (entry) {
    const override = entry[1];
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
  const entry = memoOverrideEntryForStep(overrides, workInstructionStepKey(step));
  const override = entry?.[1];
  return override?.action === 'USE_SOURCE' || override?.action === 'use-source' ? null : override ?? null;
}

export function updateWorkInstructionMemo(
  overrides: WorkInstructionMemoOverrideMap,
  step: WorkInstructionEditorStepDto,
  memo: string
): WorkInstructionMemoOverrideMap {
  const stepKey = workInstructionStepKey(step);
  const currentEntry = memoOverrideEntryForStep(overrides, stepKey);
  const current = currentEntry?.[1];
  const mapKey = currentEntry?.[0] ?? nextMemoOverrideMapKey(overrides, stepKey);
  return {
    ...overrides,
    [mapKey]: {
      stepKey,
      id: current?.id ?? mapKey,
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
  const currentEntry = memoOverrideEntryForStep(overrides, key);
  if (!currentEntry) return overrides;
  const [mapKey, current] = currentEntry;
  return {
    ...overrides,
    [mapKey]: {
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
  const currentEntry = memoOverrideEntryForStep(overrides, stepKey);
  if (!currentEntry) return overrides;
  const [mapKey, current] = currentEntry;
  return {
    ...overrides,
    [mapKey]: {
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
