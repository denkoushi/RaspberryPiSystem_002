import type { AssemblyProcedureStepDraft } from './assemblyProcedureStepDraft';
import type { AssemblyDraftArea, AssemblyDraftCheckItem } from './assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from './assemblyTemplateProcedureDraft';

export const ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_SCHEMA_VERSION = 1 as const;
export const ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_KEY_PREFIX = 'assembly-template-editor-recovery:v1';

export type AssemblyTemplateEditorRecoveryMode = 'new' | 'revise';

export type AssemblyTemplateEditorRecoveryDraft = {
  templateName: string;
  modelCode: string;
  procedurePattern: string;
  procedureItems: AssemblyTemplateProcedureDraftItem[];
  procedureSteps: AssemblyProcedureStepDraft[];
  areas: AssemblyDraftArea[];
  checkItems: AssemblyDraftCheckItem[];
};

export type AssemblyTemplateEditorRecoveryV1 = {
  schemaVersion: typeof ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_SCHEMA_VERSION;
  mode: AssemblyTemplateEditorRecoveryMode;
  targetKey: string;
  baseTemplateId: string | null;
  baseUpdatedAt: string | null;
  savedAt: string;
  draft: AssemblyTemplateEditorRecoveryDraft;
};

export function buildAssemblyTemplateEditorRecoveryKey(input: {
  mode: AssemblyTemplateEditorRecoveryMode;
  templateId?: string | null;
  sourceTemplateId?: string | null;
  procedureDocumentId?: string | null;
}): string {
  const target =
    input.mode === 'revise'
      ? input.templateId
      : input.sourceTemplateId
        ? `source:${input.sourceTemplateId}`
        : input.procedureDocumentId
          ? `document:${input.procedureDocumentId}`
          : 'blank';
  return `${RECOVERY_KEY_PREFIX}:${input.mode}:${target ?? 'unknown'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDraft(value: unknown): value is AssemblyTemplateEditorRecoveryDraft {
  if (!isRecord(value)) return false;
  return (
    typeof value.templateName === 'string' &&
    typeof value.modelCode === 'string' &&
    typeof value.procedurePattern === 'string' &&
    Array.isArray(value.procedureItems) &&
    Array.isArray(value.procedureSteps) &&
    Array.isArray(value.areas) &&
    Array.isArray(value.checkItems)
  );
}

export function createAssemblyTemplateEditorRecoveryRecord(input: {
  mode: AssemblyTemplateEditorRecoveryMode;
  targetKey: string;
  baseTemplateId?: string | null;
  baseUpdatedAt?: string | null;
  draft: AssemblyTemplateEditorRecoveryDraft;
  savedAt?: Date;
}): AssemblyTemplateEditorRecoveryV1 {
  return {
    schemaVersion: ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_SCHEMA_VERSION,
    mode: input.mode,
    targetKey: input.targetKey,
    baseTemplateId: input.baseTemplateId ?? null,
    baseUpdatedAt: input.baseUpdatedAt ?? null,
    savedAt: (input.savedAt ?? new Date()).toISOString(),
    draft: input.draft
  };
}

export function serializeAssemblyTemplateEditorRecovery(
  record: AssemblyTemplateEditorRecoveryV1
): string {
  return JSON.stringify(record);
}

export function parseAssemblyTemplateEditorRecovery(
  raw: string,
  now = new Date()
): AssemblyTemplateEditorRecoveryV1 | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_SCHEMA_VERSION ||
      (parsed.mode !== 'new' && parsed.mode !== 'revise') ||
      typeof parsed.targetKey !== 'string' ||
      (parsed.baseTemplateId !== null && typeof parsed.baseTemplateId !== 'string') ||
      (parsed.baseUpdatedAt !== null && typeof parsed.baseUpdatedAt !== 'string') ||
      typeof parsed.savedAt !== 'string' ||
      !isDraft(parsed.draft)
    ) {
      return null;
    }
    const savedAt = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAt) || now.getTime() - savedAt > ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_TTL_MS) {
      return null;
    }
    if (savedAt > now.getTime() + 5 * 60 * 1000) return null;
    return parsed as unknown as AssemblyTemplateEditorRecoveryV1;
  } catch {
    return null;
  }
}

export function isAssemblyTemplateEditorRecoveryCompatible(
  record: AssemblyTemplateEditorRecoveryV1,
  input: {
    mode: AssemblyTemplateEditorRecoveryMode;
    targetKey: string;
    templateId?: string | null;
    updatedAt?: string | null;
    isActive?: boolean;
    currentModelCode?: string;
    currentProcedurePattern?: string;
  }
): boolean {
  if (record.mode !== input.mode || record.targetKey !== input.targetKey) return false;
  if (input.mode === 'revise') {
    if (!input.templateId || record.baseTemplateId !== input.templateId) return false;
    if (input.isActive === false) return false;
    if ((record.baseUpdatedAt ?? null) !== (input.updatedAt ?? null)) return false;
    if (
      input.currentModelCode != null &&
      record.draft.modelCode.trim() !== input.currentModelCode.trim()
    ) {
      return false;
    }
    if (
      input.currentProcedurePattern != null &&
      record.draft.procedurePattern.trim() !== input.currentProcedurePattern.trim()
    ) {
      return false;
    }
  }
  return true;
}
