import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  computeWorkInstructionMemoFingerprint,
  computeWorkInstructionStepFingerprint,
  copyWorkInstructionMemoOverrides,
  copyWorkInstructionOverlays,
  normalizeWorkInstructionMemoOverride,
  normalizeWorkInstructionOverlayElement,
  stepNumber,
  type WorkInstructionEditRevisionView,
  type WorkInstructionEditRevisionContext,
  type WorkInstructionEditingView,
  type WorkInstructionOverlayElement,
  type WorkInstructionOverlayElementInput,
  type WorkInstructionMemoOverride,
  type WorkInstructionMemoOverrideInput,
  type WorkInstructionMemoCopyResult,
  type WorkInstructionSourceVersionStepLike,
  type WorkInstructionSourceVersionView,
  type WorkInstructionCopyResult,
  type WorkInstructionEditAssetView,
  type WorkInstructionEditAssetOriginInput,
  type WorkInstructionSourceVersionStepView,
  WorkInstructionEditingError
} from '../domain/editing.js';
import {
  ensureWorkInstructionPublicationForRow,
  sourceVersionStepLike,
  toSourceVersionView,
  workInstructionSourceVersionInclude,
  type WorkInstructionSourceVersionRecord
} from './prisma-work-instruction-version.persistence.js';
import {
  memoOverrideToCreateData,
  overlayToCreateData,
  toEditAssetView,
  toEditRevisionView,
  workInstructionEditRevisionInclude,
  type WorkInstructionEditRevisionRecord
} from './prisma-work-instruction-edit.persistence.js';
import type { WorkInstructionDbClient } from './prisma-work-instruction.persistence.types.js';
import type {
  WorkInstructionEditAssetCleanupCandidate,
  WorkInstructionEditorAuthorization,
  WorkInstructionEditorAuthenticationView,
  WorkInstructionEditAuditAction,
  WorkInstructionEditAuditLogView,
  WorkInstructionEditRepository,
  WorkInstructionGroupIdentity,
  WorkInstructionPublishRevisionInput,
  WorkInstructionPublishRevisionResult,
  RequiredWorkInstructionEditorAuthorization
} from './work-instruction-edit-repository.port.js';

type SourceRowForEditing = {
  id: string;
  sourceSystem: string;
  sourceList: string;
  sourceItemId: bigint;
  sourceModified: Date;
  partNumber: string | null;
  shootingTarget: string | null;
  rawManifest: Prisma.JsonValue;
  contentHash: string;
  steps: ReadonlyArray<{
    step: bigint;
    text: string;
    imageName: string | null;
    assetId: string | null;
    asset: { sha256: string } | null;
  }>;
};

const sourceRowInclude = {
  steps: {
    orderBy: { step: 'asc' as const },
    include: { asset: true }
  }
} as const;

const sourcePublicationInclude = {
  latestVersion: { include: workInstructionSourceVersionInclude },
  publishedVersion: { include: workInstructionSourceVersionInclude },
  publishedRevision: { include: workInstructionEditRevisionInclude }
} as const;

const EDIT_ASSET_MAX_AGE_MS = 60 * 60 * 1000;
const WORK_INSTRUCTION_EDITOR_AUTH_TTL_MS = 4 * 60 * 60 * 1000;

type EditorAuthRecord = {
  id: string;
  employeeId: string | null;
  employeeCodeSnapshot: string;
  employeeNameSnapshot: string;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string;
  partNumber: string;
  shootingTarget: string;
  authenticatedAt: Date;
  expiresAt: Date;
  employee?: { status: string } | null;
  clientDevice?: { id: string; name: string } | null;
};

type AuditContext = {
  authenticationId: string;
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeNameSnapshot: string;
  clientDeviceId: string;
  clientDeviceNameSnapshot: string;
  partNumber: string;
  shootingTarget: string;
};

type AuditRequest = WorkInstructionEditorAuthorization;
type NormalizedAuditRequest = {
  authenticationId: string;
  clientDeviceId: string;
  requestId: string;
};

function authRequired(): never {
  throw new WorkInstructionEditingError(401, 'この画面で社員NFCタグをスキャンしてください', 'WORK_INSTRUCTION_EDITOR_AUTHENTICATION_REQUIRED');
}

function authInvalid(): never {
  throw new WorkInstructionEditingError(403, 'この作業要領画面の社員NFC認証が必要です', 'WORK_INSTRUCTION_EDITOR_AUTHENTICATION_INVALID');
}

function authExpired(): never {
  throw new WorkInstructionEditingError(403, '作業要領編集の社員NFC認証の有効期限が切れています', 'WORK_INSTRUCTION_EDITOR_AUTHENTICATION_EXPIRED');
}

function authDeviceMismatch(): never {
  throw new WorkInstructionEditingError(403, '別の端末で認証された社員NFCは使用できません', 'WORK_INSTRUCTION_EDITOR_AUTHENTICATION_DEVICE_MISMATCH');
}

function authGroupMismatch(): never {
  throw new WorkInstructionEditingError(403, '別の作業要領グループで認証された社員NFCは使用できません', 'WORK_INSTRUCTION_EDITOR_AUTHENTICATION_GROUP_MISMATCH');
}

function authEmployeeInactive(): never {
  throw new WorkInstructionEditingError(403, '有効な社員のNFC認証が必要です', 'WORK_INSTRUCTION_EDITOR_EMPLOYEE_INACTIVE');
}

function normalizeAuditRequest(input: AuditRequest | undefined): NormalizedAuditRequest | null {
  if (!input?.authenticationId) return null;
  const authenticationId = input.authenticationId.trim();
  const clientDeviceId = input.clientDeviceId?.trim() ?? '';
  const requestId = input.requestId?.trim() ?? '';
  if (!authenticationId) authRequired();
  if (!clientDeviceId) {
    throw new WorkInstructionEditingError(401, 'キオスク端末の識別が必要です', 'CLIENT_KEY_REQUIRED');
  }
  return { authenticationId, clientDeviceId, requestId: requestId || randomUUID() };
}

function authView(record: EditorAuthRecord): WorkInstructionEditorAuthenticationView {
  if (!record.employeeId || !record.clientDeviceId) authInvalid();
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeCodeSnapshot: record.employeeCodeSnapshot,
    employeeNameSnapshot: record.employeeNameSnapshot,
    clientDeviceId: record.clientDeviceId,
    clientDeviceNameSnapshot: record.clientDeviceNameSnapshot,
    partNumber: record.partNumber,
    shootingTarget: record.shootingTarget,
    authenticatedAt: record.authenticatedAt,
    expiresAt: record.expiresAt
  };
}

function auditContextView(record: EditorAuthRecord): AuditContext {
  const view = authView(record);
  return {
    authenticationId: view.id,
    employeeId: view.employeeId,
    employeeCodeSnapshot: view.employeeCodeSnapshot,
    employeeNameSnapshot: view.employeeNameSnapshot,
    clientDeviceId: view.clientDeviceId,
    clientDeviceNameSnapshot: view.clientDeviceNameSnapshot,
    partNumber: view.partNumber,
    shootingTarget: view.shootingTarget
  };
}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function notFound(message: string, code: string): never {
  throw new WorkInstructionEditingError(404, message, code);
}

function conflict(message: string, code: string, details?: unknown): never {
  throw new WorkInstructionEditingError(409, message, code, details);
}

function normalizeGroupValue(value: string | null | undefined): string | null {
  return value == null ? null : value.normalize('NFKC').trim().toUpperCase();
}

function groupMatches(
  version: { partNumber: string | null; shootingTarget: string | null },
  expectedGroup: WorkInstructionGroupIdentity
): boolean {
  return normalizeGroupValue(version.partNumber) === normalizeGroupValue(expectedGroup.partNumber)
    && normalizeGroupValue(version.shootingTarget) === normalizeGroupValue(expectedGroup.shootingTarget);
}

function assertGroupMembership(
  targetVersion: { partNumber: string | null; shootingTarget: string | null },
  publishedVersion: { partNumber: string | null; shootingTarget: string | null } | null,
  expectedGroup: WorkInstructionGroupIdentity | undefined
): void {
  if (!expectedGroup || groupMatches(targetVersion, expectedGroup) || (publishedVersion != null && groupMatches(publishedVersion, expectedGroup))) return;
  conflict('指定された作業要領グループに属さない改版です', 'WORK_INSTRUCTION_GROUP_MEMBERSHIP_CONFLICT', {
    expectedPartNumber: expectedGroup.partNumber,
    expectedShootingTarget: expectedGroup.shootingTarget
  });
}

function asSourceRow(row: SourceRowForEditing): SourceRowForEditing {
  return row;
}

function versionStepViews(record: WorkInstructionSourceVersionRecord): WorkInstructionSourceVersionStepView[] {
  return record.steps.map((step) => ({
    id: step.id,
    step: stepNumber(step.step),
    text: step.text,
    imageName: step.imageName,
    imageAssetId: step.imageAssetId,
    imageStorageKey: step.imageAsset?.storageKey ?? null,
    imageMimeType: step.imageAsset?.mimeType ?? null,
    imageSha256: step.imageSha256 ?? step.imageAsset?.sha256 ?? null,
    imageDeletedAt: step.imageDeletedAt,
    imageDeletedBy: step.imageDeletedBy
  }));
}

function sourceVersionAsLike(record: WorkInstructionSourceVersionRecord): WorkInstructionSourceVersionStepLike[] {
  return record.steps.map(sourceVersionStepLike);
}

function memoMigrationSummary(memoOverrides: ReadonlyArray<WorkInstructionMemoOverride>) {
  return {
    needsReviewCount: memoOverrides.filter((memo) => memo.migrationState === 'NEEDS_REVIEW').length,
    unassignedCount: memoOverrides.filter((memo) => memo.migrationState === 'UNASSIGNED').length,
    skippedCount: memoOverrides.filter((memo) => memo.migrationState === 'SKIPPED').length
  };
}

function migrationSummary(
  overlays: ReadonlyArray<WorkInstructionOverlayElement>,
  memoOverrides: ReadonlyArray<WorkInstructionMemoOverride> = []
) {
  return {
    needsReviewCount: overlays.filter((overlay) => overlay.migrationState === 'NEEDS_REVIEW').length,
    unassignedCount: overlays.filter((overlay) => overlay.migrationState === 'UNASSIGNED').length,
    skippedCount: overlays.filter((overlay) => overlay.migrationState === 'SKIPPED').length,
    memo: memoMigrationSummary(memoOverrides)
  };
}

function diffById<T extends { id: string }>(
  before: ReadonlyArray<T>,
  after: ReadonlyArray<T>
): { added: T[]; updated: Array<{ before: T; after: T }>; deleted: T[] } {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const added: T[] = [];
  const updated: Array<{ before: T; after: T }> = [];
  const deleted: T[] = [];
  for (const item of after) {
    const previous = beforeById.get(item.id);
    if (!previous) {
      added.push(item);
    } else if (JSON.stringify(previous) !== JSON.stringify(item)) {
      updated.push({ before: previous, after: item });
    }
  }
  for (const item of before) if (!afterById.has(item.id)) deleted.push(item);
  return { added, updated, deleted };
}

function revisionChangeSet(
  before: WorkInstructionEditRevisionView,
  after: { overlays: ReadonlyArray<WorkInstructionOverlayElement>; memoOverrides: ReadonlyArray<WorkInstructionMemoOverride> }
) {
  return {
    overlays: diffById(before.overlays, after.overlays),
    memoOverrides: diffById(before.memoOverrides ?? [], after.memoOverrides)
  };
}

async function lockPublicationForVersion(tx: WorkInstructionDbClient, sourceVersionId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT publication."rowId"
    FROM "WorkInstructionSourcePublication" AS publication
    JOIN "WorkInstructionSourceVersion" AS version
      ON version."rowId" = publication."rowId"
    WHERE version."id" = ${sourceVersionId}
    FOR UPDATE OF publication
  `);
}

async function lockSourceVersion(tx: WorkInstructionDbClient, sourceVersionId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "WorkInstructionSourceVersion" WHERE "id" = ${sourceVersionId} FOR UPDATE
  `);
}

async function lockRevision(tx: WorkInstructionDbClient, revisionId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "WorkInstructionEditRevision" WHERE "id" = ${revisionId} FOR UPDATE
  `);
}

async function findRevisionWithSource(
  db: WorkInstructionDbClient,
  revisionId: string
): Promise<(WorkInstructionEditRevisionRecord & { sourceVersion: WorkInstructionSourceVersionRecord }) | null> {
  return db.workInstructionEditRevision.findUnique({
    where: { id: revisionId },
    include: {
      ...workInstructionEditRevisionInclude,
      sourceVersion: { include: workInstructionSourceVersionInclude }
    }
  });
}

async function findRow(db: WorkInstructionDbClient, rowId: string): Promise<SourceRowForEditing | null> {
  return db.workInstructionRow.findUnique({ where: { id: rowId }, include: sourceRowInclude });
}

async function findPublication(
  db: WorkInstructionDbClient,
  rowId: string
) {
  return db.workInstructionSourcePublication.findUnique({
    where: { rowId },
    include: sourcePublicationInclude
  });
}

function normalizeElementsForVersion(
  version: WorkInstructionSourceVersionRecord,
  elements: ReadonlyArray<WorkInstructionOverlayElementInput>
): WorkInstructionOverlayElement[] {
  const byStep = new Map(version.steps.map((step) => [stepNumber(step.step), step]));
  return elements.map((input, index) => {
    const targetStep = input.sourceStep == null ? null : byStep.get(input.sourceStep);
    if (input.sourceStep != null && !targetStep) {
      throw new WorkInstructionEditingError(400, `overlay ${index + 1} source step does not exist`, 'WORK_INSTRUCTION_OVERLAY_STEP_NOT_FOUND');
    }
    const fallback = targetStep ? computeWorkInstructionStepFingerprint(sourceVersionStepLike(targetStep)) : '';
    const normalized = normalizeWorkInstructionOverlayElement(input, fallback, index);
    if (targetStep) {
      const targetFingerprint = computeWorkInstructionStepFingerprint(sourceVersionStepLike(targetStep));
      return {
        ...normalized,
        targetStepFingerprint: input.targetStepFingerprint ?? targetFingerprint,
        migratedFromStep: input.migratedFromStep ?? normalized.sourceStep ?? stepNumber(targetStep.step),
        baseStepFingerprint: input.baseStepFingerprint ?? targetFingerprint
      };
    }
    return normalized;
  });
}

function normalizeMemoOverridesForVersion(
  version: WorkInstructionSourceVersionRecord,
  inputs: ReadonlyArray<WorkInstructionMemoOverrideInput>,
  existingOverrides: ReadonlyArray<WorkInstructionMemoOverride>
): WorkInstructionMemoOverride[] {
  const byStep = new Map(version.steps.map((step) => [stepNumber(step.step), step]));
  const existingById = new Map(existingOverrides.map((memo) => [memo.id, memo]));
  const seenExistingIds = new Set<string>();
  const seenTargetSteps = new Set<number>();
  const normalized: WorkInstructionMemoOverride[] = [];
  for (const [index, input] of inputs.entries()) {
    const action = String(input.action ?? 'AUTO').toUpperCase().replace(/-/g, '_');
    const existing = input.id
      ? existingById.get(input.id)
      : existingOverrides.find((memo) => memo.migratedFromStep === (input.migratedFromStep ?? input.sourceStep) && !seenExistingIds.has(memo.id));
    const migratedFromStep = input.migratedFromStep ?? existing?.migratedFromStep ?? input.sourceStep;
    if (migratedFromStep == null || !Number.isSafeInteger(migratedFromStep) || migratedFromStep <= 0) {
      throw new WorkInstructionEditingError(400, `memo ${index + 1} original source step is invalid`, 'WORK_INSTRUCTION_MEMO_STEP_INVALID');
    }
    if (existing) {
      if (seenExistingIds.has(existing.id)) {
        throw new WorkInstructionEditingError(400, `memo ${index + 1} is duplicated`, 'WORK_INSTRUCTION_DUPLICATE_MEMO');
      }
      seenExistingIds.add(existing.id);
    }
    if (action === 'USE_SOURCE') continue;
    if (input.sourceStep !== null) {
      if (seenTargetSteps.has(input.sourceStep)) {
        throw new WorkInstructionEditingError(400, `memo ${index + 1} target step is duplicated`, 'WORK_INSTRUCTION_DUPLICATE_MEMO_TARGET');
      }
      seenTargetSteps.add(input.sourceStep);
    }
    const targetStep = input.sourceStep == null ? null : byStep.get(input.sourceStep);
    if (input.sourceStep != null && !targetStep) {
      throw new WorkInstructionEditingError(400, `memo ${index + 1} source step does not exist`, 'WORK_INSTRUCTION_MEMO_STEP_NOT_FOUND');
    }
    const targetFingerprint = targetStep
      ? computeWorkInstructionMemoFingerprint(sourceVersionStepLike(targetStep))
      : null;
    if (!existing && input.sourceStep == null) {
      throw new WorkInstructionEditingError(409, '新規memoは既存の手順に割り当ててください', 'WORK_INSTRUCTION_MEMO_ASSIGNMENT_REQUIRED');
    }
    if (existing && action === 'AUTO') {
      if (existing.migrationState === 'NEEDS_REVIEW' || existing.migrationState === 'UNASSIGNED') {
        conflict('memoの移植状態をKEEPまたはUSE_SOURCEで解決してください', 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED', {
          migratedFromStep: existing.migratedFromStep,
          migrationState: existing.migrationState
        });
      }
      if (input.sourceStep !== existing.sourceStep) {
        conflict('memoの手順割当変更にはKEEPを明示してください', 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED', {
          migratedFromStep: existing.migratedFromStep,
          sourceStep: existing.sourceStep
        });
      }
    }
    if (action === 'KEEP') {
      const expected = input.expectedTargetStepFingerprint ?? input.targetStepFingerprint;
      if (!targetFingerprint || !expected) {
        throw new WorkInstructionEditingError(400, 'memo keepにはtarget fingerprintが必要です', 'WORK_INSTRUCTION_MEMO_KEEP_FINGERPRINT_REQUIRED');
      }
      if (expected !== targetFingerprint) {
        conflict('memoの原本が保存中に変更されました', 'WORK_INSTRUCTION_MEMO_FINGERPRINT_CONFLICT', {
          sourceStep: input.sourceStep,
          expectedTargetStepFingerprint: expected,
          currentTargetStepFingerprint: targetFingerprint
        });
      }
    }
    const fallbackFingerprint = existing?.baseStepFingerprint
      ?? targetFingerprint
      ?? '';
    const trustedMigrationState = existing?.migrationState
      ?? (targetStep ? 'MIGRATED' : 'UNASSIGNED');
    let memo: WorkInstructionMemoOverride;
    try {
      memo = normalizeWorkInstructionMemoOverride({
        ...input,
        id: existing?.id ?? input.id,
        migratedFromStep,
        baseStepFingerprint: fallbackFingerprint,
        targetStepFingerprint: targetFingerprint,
        migrationState: action === 'KEEP'
          ? 'MIGRATED'
          : trustedMigrationState
      }, fallbackFingerprint, index);
    } catch (error) {
      throw new WorkInstructionEditingError(400, error instanceof Error ? error.message : String(error), 'WORK_INSTRUCTION_MEMO_INVALID');
    }
    normalized.push(memo);
  }
  for (const existing of existingOverrides) {
    if (!seenExistingIds.has(existing.id)) {
      throw new WorkInstructionEditingError(409, '既存memoにはKEEPまたはUSE_SOURCEを明示してください', 'WORK_INSTRUCTION_MEMO_ACTION_REQUIRED', {
        migratedFromStep: existing.migratedFromStep
      });
    }
  }
  return normalized;
}

function copySummary(
  overlays: ReadonlyArray<WorkInstructionOverlayElement>,
  memo: WorkInstructionMemoCopyResult
): WorkInstructionCopyResult {
  return {
    elements: overlays,
    copiedCount: overlays.length,
    needsReviewCount: overlays.filter((overlay) => overlay.migrationState === 'NEEDS_REVIEW').length,
    unassignedCount: overlays.filter((overlay) => overlay.migrationState === 'UNASSIGNED').length,
    skippedCount: overlays.filter((overlay) => overlay.migrationState === 'SKIPPED').length,
    unassignedIds: overlays.filter((overlay) => overlay.migrationState === 'UNASSIGNED').map((overlay) => overlay.id),
    memo
  };
}

function emptyMemoCopy(): WorkInstructionMemoCopyResult {
  return { overrides: [], copiedCount: 0, needsReviewCount: 0, unassignedCount: 0, skippedCount: 0, unassignedIds: [] };
}

export class PrismaWorkInstructionEditRepository implements WorkInstructionEditRepository {
  private readonly db: PrismaClient;

  constructor(options: { db?: PrismaClient } = {}) {
    this.db = options.db ?? prisma;
  }

  async createEditorAuthentication(input: {
    partNumber: string;
    shootingTarget: string;
    employeeTagUid: string;
    clientDeviceId: string;
    now?: Date;
  }): Promise<WorkInstructionEditorAuthenticationView> {
    const partNumber = input.partNumber.trim();
    const shootingTarget = input.shootingTarget.trim();
    const employeeTagUid = input.employeeTagUid.trim();
    const clientDeviceId = input.clientDeviceId.trim();
    if (!partNumber || !shootingTarget) {
      throw new WorkInstructionEditingError(400, '作業要領グループが必要です', 'WORK_INSTRUCTION_EDITOR_GROUP_REQUIRED');
    }
    if (!employeeTagUid) {
      throw new WorkInstructionEditingError(400, '社員NFCタグが必要です', 'WORK_INSTRUCTION_EMPLOYEE_TAG_REQUIRED');
    }
    if (!clientDeviceId) {
      throw new WorkInstructionEditingError(401, 'キオスク端末の識別が必要です', 'CLIENT_KEY_REQUIRED');
    }
    const now = input.now ?? new Date();
    return this.db.$transaction(async (tx) => {
      const [employees, instrumentTag, item] = await Promise.all([
        tx.employee.findMany({
          where: { nfcTagUid: employeeTagUid },
          select: { id: true, employeeCode: true, displayName: true, nfcTagUid: true, status: true }
        }),
        tx.measuringInstrumentTag.findUnique({ where: { rfidTagUid: employeeTagUid }, select: { id: true } }),
        tx.item.findUnique({ where: { nfcTagUid: employeeTagUid }, select: { id: true } })
      ]);
      if (employees.length === 0) {
        if (instrumentTag) {
          throw new WorkInstructionEditingError(409, '計測器のNFCタグは社員認証に使用できません', 'WORK_INSTRUCTION_EMPLOYEE_TAG_IS_MEASURING_INSTRUMENT');
        }
        if (item) {
          throw new WorkInstructionEditingError(409, '社員以外のNFCタグは社員認証に使用できません', 'WORK_INSTRUCTION_EMPLOYEE_TAG_IS_NOT_EMPLOYEE');
        }
        throw new WorkInstructionEditingError(404, '社員NFCタグが登録されていません', 'WORK_INSTRUCTION_EMPLOYEE_TAG_NOT_FOUND');
      }
      if (employees.length > 1 || instrumentTag || item) {
        throw new WorkInstructionEditingError(409, 'NFCタグが複数の対象に登録されています', 'WORK_INSTRUCTION_EMPLOYEE_TAG_DUPLICATE');
      }
      const employee = employees[0]!;
      if (employee.status !== 'ACTIVE') {
        throw new WorkInstructionEditingError(403, '有効な社員のみ作業要領を編集できます', 'WORK_INSTRUCTION_EDITOR_EMPLOYEE_INACTIVE');
      }
      const clientDevice = await tx.clientDevice.findUnique({
        where: { id: clientDeviceId },
        select: { id: true, name: true }
      });
      if (!clientDevice) {
        throw new WorkInstructionEditingError(401, 'キオスク端末を確認できません', 'CLIENT_DEVICE_NOT_FOUND');
      }
      const authentication = await tx.workInstructionEditorAuthentication.create({
        data: {
          id: randomUUID(),
          employeeId: employee.id,
          employeeCodeSnapshot: employee.employeeCode,
          employeeNameSnapshot: employee.displayName,
          clientDeviceId: clientDevice.id,
          clientDeviceNameSnapshot: clientDevice.name,
          partNumber,
          shootingTarget,
          authenticatedAt: now,
          expiresAt: new Date(now.getTime() + WORK_INSTRUCTION_EDITOR_AUTH_TTL_MS)
        }
      });
      return authView(authentication as EditorAuthRecord);
    }, { timeout: 30000 });
  }

  async validateEditorAuthentication(input: WorkInstructionEditorAuthorization & {
    expectedGroup?: WorkInstructionGroupIdentity;
    revisionId?: string;
    sourceVersionId?: string;
  }): Promise<WorkInstructionEditorAuthenticationView> {
    const request = normalizeAuditRequest(input);
    if (!request) authRequired();
    return this.db.$transaction(async (tx) => {
      const auth = await this.findAndValidateEditorAuthentication(tx, request, input.expectedGroup);
      if (input.revisionId) {
        const revision = await tx.workInstructionEditRevision.findUnique({
          where: { id: input.revisionId },
          select: { sourceVersion: { select: { partNumber: true, shootingTarget: true } } }
        });
        if (!revision) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
        this.assertEditorGroup(auth, revision.sourceVersion);
      }
      if (input.sourceVersionId) {
        const version = await tx.workInstructionSourceVersion.findUnique({
          where: { id: input.sourceVersionId },
          select: { partNumber: true, shootingTarget: true }
        });
        if (!version) notFound('原本版が見つかりません', 'WORK_INSTRUCTION_SOURCE_VERSION_NOT_FOUND');
        this.assertEditorGroup(auth, version);
      }
      return authView(auth);
    });
  }

  async listEditAuditLogs(input: {
    partNumber: string;
    shootingTarget: string;
    limit?: number;
    offset?: number;
  }): Promise<ReadonlyArray<WorkInstructionEditAuditLogView>> {
    const limit = Math.min(500, Math.max(1, input.limit ?? 200));
    const offset = Math.max(0, input.offset ?? 0);
    const logs = await this.db.workInstructionEditAuditLog.findMany({
      where: { partNumber: input.partNumber.trim(), shootingTarget: input.shootingTarget.trim() },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit
    });
    return logs.map((log) => ({
      id: log.id,
      authenticationId: log.authenticationId,
      action: log.action,
      employeeIdSnapshot: log.employeeIdSnapshot,
      employeeCodeSnapshot: log.employeeCodeSnapshot,
      employeeNameSnapshot: log.employeeNameSnapshot,
      clientDeviceIdSnapshot: log.clientDeviceIdSnapshot,
      clientDeviceNameSnapshot: log.clientDeviceNameSnapshot,
      partNumber: log.partNumber,
      shootingTarget: log.shootingTarget,
      rowId: log.rowId,
      sourceVersionId: log.sourceVersionId,
      revisionId: log.revisionId,
      editVersionBefore: log.editVersionBefore,
      editVersionAfter: log.editVersionAfter,
      requestId: log.requestId,
      changeSet: log.changeSet,
      createdAt: log.createdAt
    }));
  }

  private async findAndValidateEditorAuthentication(
    db: WorkInstructionDbClient,
    request: { authenticationId: string; clientDeviceId: string },
    expectedGroup?: WorkInstructionGroupIdentity
  ): Promise<EditorAuthRecord> {
    const authentication = await db.workInstructionEditorAuthentication.findUnique({
      where: { id: request.authenticationId },
      include: {
        employee: { select: { status: true } },
        clientDevice: { select: { id: true, name: true } }
      }
    }) as EditorAuthRecord | null;
    if (!authentication || !authentication.employeeId || !authentication.clientDeviceId) authInvalid();
    if (authentication.clientDeviceId !== request.clientDeviceId) authDeviceMismatch();
    if (new Date() >= authentication.expiresAt) authExpired();
    if (authentication.employee?.status !== 'ACTIVE') authEmployeeInactive();
    if (expectedGroup) this.assertEditorGroup(authentication, expectedGroup);
    return authentication;
  }

  private assertEditorGroup(
    auth: { partNumber: string; shootingTarget: string },
    group: { partNumber: string | null; shootingTarget: string | null }
  ): void {
    if (!group.partNumber || !group.shootingTarget
      || normalizeGroupValue(auth.partNumber) !== normalizeGroupValue(group.partNumber)
      || normalizeGroupValue(auth.shootingTarget) !== normalizeGroupValue(group.shootingTarget)) {
      authGroupMismatch();
    }
  }

  private async auditContextForRevision(
    tx: WorkInstructionDbClient,
    authorization: AuditRequest | undefined,
    revision: { sourceVersion: { rowId: string; partNumber: string | null; shootingTarget: string | null } }
  ): Promise<{ context: AuditContext; requestId: string } | null> {
    const request = normalizeAuditRequest(authorization);
    if (!request) return null;
    const auth = await this.findAndValidateEditorAuthentication(tx, request);
    this.assertEditorGroup(auth, revision.sourceVersion);
    return { context: auditContextView(auth), requestId: request.requestId };
  }

  private async auditContextForSourceVersion(
    tx: WorkInstructionDbClient,
    authorization: AuditRequest | undefined,
    version: { rowId: string; partNumber: string | null; shootingTarget: string | null }
  ): Promise<{ context: AuditContext; requestId: string } | null> {
    const request = normalizeAuditRequest(authorization);
    if (!request) return null;
    const auth = await this.findAndValidateEditorAuthentication(tx, request);
    this.assertEditorGroup(auth, version);
    return { context: auditContextView(auth), requestId: request.requestId };
  }

  private async appendAudit(
    tx: WorkInstructionDbClient,
    input: {
      audit: { context: AuditContext; requestId: string } | null;
      action: WorkInstructionEditAuditAction;
      rowId?: string | null;
      sourceVersionId?: string | null;
      revisionId?: string | null;
      editVersionBefore?: number | null;
      editVersionAfter?: number | null;
      changeSet?: unknown;
    }
  ): Promise<void> {
    if (!input.audit) return;
    const { context, requestId } = input.audit;
    await tx.workInstructionEditAuditLog.create({
      data: {
        id: randomUUID(),
        authenticationId: context.authenticationId,
        action: input.action,
        employeeIdSnapshot: context.employeeId,
        employeeCodeSnapshot: context.employeeCodeSnapshot,
        employeeNameSnapshot: context.employeeNameSnapshot,
        clientDeviceIdSnapshot: context.clientDeviceId,
        clientDeviceNameSnapshot: context.clientDeviceNameSnapshot,
        partNumber: context.partNumber,
        shootingTarget: context.shootingTarget,
        rowId: input.rowId ?? null,
        sourceVersionId: input.sourceVersionId ?? null,
        revisionId: input.revisionId ?? null,
        editVersionBefore: input.editVersionBefore ?? null,
        editVersionAfter: input.editVersionAfter ?? null,
        requestId,
        changeSet: input.changeSet === undefined ? undefined : auditJson(input.changeSet)
      }
    });
  }

  async readEditingView(rowId: string): Promise<WorkInstructionEditingView | null> {
    return this.db.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "WorkInstructionRow" WHERE "id" = ${rowId} FOR UPDATE
      `);
      if (!lock[0]) return null;
      const row = await findRow(tx, rowId);
      if (!row) return null;
      await ensureWorkInstructionPublicationForRow(tx, asSourceRow(row), new Date());
      const publication = await findPublication(tx, rowId);
      if (!publication) return null;
      const draft = await tx.workInstructionEditRevision.findFirst({
        where: { sourceVersionId: publication.latestVersionId, isRevisionHead: true, status: 'DRAFT' },
        include: workInstructionEditRevisionInclude
      });
      return {
        rowId,
        source: {
          system: row.sourceSystem,
          list: row.sourceList,
          itemId: Number(row.sourceItemId),
          modified: row.sourceModified
        },
        latestVersion: {
          ...toSourceVersionView(publication.latestVersion),
          steps: versionStepViews(publication.latestVersion)
        },
        publishedVersion: {
          ...toSourceVersionView(publication.publishedVersion),
          steps: versionStepViews(publication.publishedVersion)
        },
        draftRevision: draft ? toEditRevisionView(draft) : null,
        publishedRevision: publication.publishedRevision ? toEditRevisionView(publication.publishedRevision) : null
      };
    });
  }

  async listSourceVersions(rowId: string): Promise<ReadonlyArray<WorkInstructionSourceVersionView>> {
    return this.db.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "WorkInstructionRow" WHERE "id" = ${rowId} FOR UPDATE
      `);
      if (!lock[0]) return [];
      const row = await findRow(tx, rowId);
      if (!row) return [];
      await ensureWorkInstructionPublicationForRow(tx, asSourceRow(row), new Date());
      const versions = await tx.workInstructionSourceVersion.findMany({
        where: { rowId },
        include: workInstructionSourceVersionInclude,
        orderBy: [{ sourceModified: 'desc' }, { createdAt: 'desc' }]
      });
      return versions.map((version) => ({
        ...toSourceVersionView(version),
        steps: versionStepViews(version)
      }));
    });
  }

  async readRevisionContext(revisionId: string): Promise<WorkInstructionEditRevisionContext | null> {
    return this.db.$transaction(async (tx) => {
      const revision = await findRevisionWithSource(tx, revisionId);
      if (!revision) return null;
      const row = await tx.workInstructionRow.findUnique({
        where: { id: revision.sourceVersion.rowId },
        select: { sourceSystem: true, sourceList: true, sourceItemId: true, sourceModified: true }
      });
      if (!row) return null;
      return {
        revision: toEditRevisionView(revision),
        source: {
          system: row.sourceSystem,
          list: row.sourceList,
          itemId: Number(row.sourceItemId),
          modified: row.sourceModified
        },
        sourceVersion: {
          ...toSourceVersionView(revision.sourceVersion),
          steps: versionStepViews(revision.sourceVersion)
        }
      };
    });
  }

  async findSourceVersionForDeletion(sourceVersionId: string): Promise<WorkInstructionSourceVersionView | null> {
    const version = await this.db.workInstructionSourceVersion.findUnique({
      where: { id: sourceVersionId },
      include: workInstructionSourceVersionInclude
    });
    return version ? { ...toSourceVersionView(version), steps: versionStepViews(version) } : null;
  }

  async readRevisionSourceImage(revisionId: string, step: number): Promise<{ assetId: string; storageKey: string; mimeType: string; sourceVersionId: string; sourceStep: number } | null> {
    if (!Number.isSafeInteger(step) || step <= 0) return null;
    const revision = await this.db.workInstructionEditRevision.findUnique({
      where: { id: revisionId },
      select: { sourceVersionId: true }
    });
    if (!revision) return null;
    const sourceStep = await this.db.workInstructionSourceVersionStep.findUnique({
      where: { sourceVersionId_step: { sourceVersionId: revision.sourceVersionId, step: BigInt(step) } },
      include: { imageAsset: true }
    });
    if (!sourceStep?.imageAsset || sourceStep.imageAsset.status !== 'ACTIVE') return null;
    return {
      assetId: sourceStep.imageAsset.id,
      storageKey: sourceStep.imageAsset.storageKey,
      mimeType: sourceStep.imageAsset.mimeType,
      sourceVersionId: revision.sourceVersionId,
      sourceStep: stepNumber(sourceStep.step)
    };
  }

  async createDraftRevision(input: {
    rowId: string;
    sourceVersionId?: string;
    copyFromRevisionId?: string;
    expectedPublishedVersionId?: string;
    expectedLatestVersionId?: string;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }> {
    return this.db.$transaction((tx) => this.createDraftRevisionInTransaction(tx, input));
  }

  private async createDraftRevisionInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      rowId: string;
      sourceVersionId?: string;
      copyFromRevisionId?: string;
      expectedPublishedVersionId?: string;
      expectedLatestVersionId?: string;
      editorAuthenticationId?: string | null;
      clientDeviceId?: string | null;
      requestId?: string | null;
    },
    expectedGroup?: WorkInstructionGroupIdentity
  ): Promise<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }> {
      const lock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "WorkInstructionRow" WHERE "id" = ${input.rowId} FOR UPDATE
      `);
      if (!lock[0]) notFound('作業要領が見つかりません', 'WORK_INSTRUCTION_ROW_NOT_FOUND');
      const row = await findRow(tx, input.rowId);
      if (!row) notFound('作業要領が見つかりません', 'WORK_INSTRUCTION_ROW_NOT_FOUND');
      await ensureWorkInstructionPublicationForRow(tx, asSourceRow(row), new Date());
      const publication = await findPublication(tx, input.rowId);
      if (!publication) notFound('作業要領公開状態が見つかりません', 'WORK_INSTRUCTION_PUBLICATION_NOT_FOUND');
      if ((input.expectedPublishedVersionId !== undefined && input.expectedPublishedVersionId !== publication.publishedVersionId)
        || (input.expectedLatestVersionId !== undefined && input.expectedLatestVersionId !== publication.latestVersionId)) {
        conflict('原本が再取込されています。最新版を再読込して注記を再適用してください', 'WORK_INSTRUCTION_SOURCE_CONFLICT', {
          latestVersionId: publication.latestVersionId,
          publishedVersionId: publication.publishedVersionId
        });
      }
      const targetVersionId = input.sourceVersionId ?? publication.latestVersionId;
      const targetVersion = await tx.workInstructionSourceVersion.findUnique({
        where: { id: targetVersionId },
        include: workInstructionSourceVersionInclude
      });
      if (!targetVersion || targetVersion.rowId !== input.rowId) notFound('対象原本版が見つかりません', 'WORK_INSTRUCTION_SOURCE_VERSION_NOT_FOUND');
      const publishedVersion = publication.publishedVersionId === targetVersion.id
        ? targetVersion
        : await tx.workInstructionSourceVersion.findUnique({
          where: { id: publication.publishedVersionId },
          select: { partNumber: true, shootingTarget: true }
        });
      assertGroupMembership(targetVersion, publishedVersion, expectedGroup);
      const audit = await this.auditContextForSourceVersion(tx, {
        authenticationId: input.editorAuthenticationId,
        clientDeviceId: input.clientDeviceId,
        requestId: input.requestId
      }, targetVersion);
      if (audit && expectedGroup) this.assertEditorGroup(audit.context, expectedGroup);
      const existing = await tx.workInstructionEditRevision.findFirst({
        where: { sourceVersionId: targetVersion.id, isRevisionHead: true, status: 'DRAFT' },
        include: workInstructionEditRevisionInclude
      });
      if (existing) {
        const existingView = toEditRevisionView(existing);
        const overlays = existingView.overlays;
        const memoOverrides = existingView.memoOverrides ?? [];
        const memo = {
          overrides: memoOverrides,
          copiedCount: memoOverrides.length,
          needsReviewCount: memoOverrides.filter((item) => item.migrationState === 'NEEDS_REVIEW').length,
          unassignedCount: memoOverrides.filter((item) => item.migrationState === 'UNASSIGNED').length,
          skippedCount: memoOverrides.filter((item) => item.migrationState === 'SKIPPED').length,
          unassignedIds: memoOverrides.filter((item) => item.migrationState === 'UNASSIGNED').map((item) => item.id)
        } satisfies WorkInstructionMemoCopyResult;
        return {
          revision: existingView,
          copy: copySummary(overlays, memo)
        };
      }
      const copySourceId = input.copyFromRevisionId ?? publication.publishedRevisionId ?? undefined;
      const copySource = copySourceId ? await findRevisionWithSource(tx, copySourceId) : null;
      if (input.copyFromRevisionId && !copySource) notFound('コピー元改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      if (copySource && copySource.sourceVersion.rowId !== targetVersion.rowId) {
        conflict('別の原本行の改版はコピーできません', 'WORK_INSTRUCTION_CROSS_ROW_COPY_NOT_ALLOWED');
      }
      const overlayCopy = copySource
        ? copyWorkInstructionOverlays({
          sourceSteps: sourceVersionAsLike(copySource.sourceVersion),
          targetSteps: sourceVersionAsLike(targetVersion),
          overlays: toEditRevisionView(copySource).overlays
        })
        : { elements: [], copiedCount: 0, needsReviewCount: 0, unassignedCount: 0, skippedCount: 0, unassignedIds: [] };
      const memoCopy = copySource
        ? copyWorkInstructionMemoOverrides({
          sourceSteps: sourceVersionAsLike(copySource.sourceVersion),
          targetSteps: sourceVersionAsLike(targetVersion),
          overrides: toEditRevisionView(copySource).memoOverrides ?? []
        })
        : emptyMemoCopy();
      const copy = copySummary(overlayCopy.elements, memoCopy);
      const previousHead = await tx.workInstructionEditRevision.findFirst({
        where: { sourceVersionId: targetVersion.id, isRevisionHead: true },
        orderBy: { revisionNumber: 'desc' }
      });
      if (previousHead) {
        await tx.workInstructionEditRevision.update({ where: { id: previousHead.id }, data: { isRevisionHead: false } });
      }
      const max = await tx.workInstructionEditRevision.aggregate({ where: { sourceVersionId: targetVersion.id }, _max: { revisionNumber: true } });
      const revision = await tx.workInstructionEditRevision.create({
        data: {
          id: randomUUID(),
          sourceVersionId: targetVersion.id,
          revisionNumber: (max._max.revisionNumber ?? 0) + 1,
          supersedesRevisionId: previousHead?.id ?? null,
          copiedFromRevisionId: copySource?.id ?? null,
          isRevisionHead: true,
          status: 'DRAFT',
          editVersion: 0,
          baseContentHash: targetVersion.contentHash
        },
        include: workInstructionEditRevisionInclude
      });
      if (copy.elements.length > 0) {
        await tx.workInstructionEditOverlay.createMany({ data: copy.elements.map((element) => overlayToCreateData(revision.id, element)) });
      }
      if (memoCopy.overrides.length > 0) {
        await tx.workInstructionEditMemoOverride.createMany({ data: memoCopy.overrides.map((memo) => memoOverrideToCreateData(revision.id, memo)) });
      }
      const withOverlays = await tx.workInstructionEditRevision.findUnique({ where: { id: revision.id }, include: workInstructionEditRevisionInclude });
      if (!withOverlays) throw new Error('draft revision disappeared after creation');
      await this.appendAudit(tx, {
        audit,
        action: 'DRAFT_CREATED',
        rowId: targetVersion.rowId,
        sourceVersionId: targetVersion.id,
        revisionId: withOverlays.id,
        editVersionBefore: null,
        editVersionAfter: withOverlays.editVersion,
        changeSet: {
          copiedFromRevisionId: copySource?.id ?? null,
          overlayCount: copy.elements.length,
          memoCount: memoCopy.overrides.length
        }
      });
      return { revision: toEditRevisionView(withOverlays), copy };
  }

  async createDraftRevisionGroup(inputs: ReadonlyArray<{
    rowId: string;
    sourceVersionId?: string;
    copyFromRevisionId?: string;
    expectedPublishedVersionId?: string;
    expectedLatestVersionId?: string;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }>, expectedGroup?: WorkInstructionGroupIdentity, authorization?: WorkInstructionEditorAuthorization): Promise<ReadonlyArray<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }>> {
    if (inputs.length === 0) return [];
    if (new Set(inputs.map((input) => input.rowId)).size !== inputs.length) {
      throw new WorkInstructionEditingError(400, '同じ作業要領を複数回指定できません', 'WORK_INSTRUCTION_DUPLICATE_ROW');
    }
    const sortedRowIds = [...inputs].map((input) => input.rowId).sort();
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "WorkInstructionRow"
        WHERE "id" IN (${Prisma.join(sortedRowIds)})
        ORDER BY "id" ASC
        FOR UPDATE
      `);
      const results: Array<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }> = [];
      for (const input of inputs) {
        // The outer transaction owns every row lock before any revision is
        // changed, so a stale item rolls back the complete group.
        // eslint-disable-next-line no-await-in-loop
        results.push(await this.createDraftRevisionInTransaction(tx, {
          ...input,
          editorAuthenticationId: input.editorAuthenticationId ?? authorization?.authenticationId,
          clientDeviceId: input.clientDeviceId ?? authorization?.clientDeviceId,
          requestId: input.requestId ?? authorization?.requestId
        }, expectedGroup));
      }
      return results;
    }, { timeout: 30000 });
  }

  async saveOverlays(input: {
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView> {
    // Compatibility adapter: an old overlay-only write must never clear the
    // revision's memo rows.  `undefined` is intentionally distinct from [] in
    // saveDraft, where [] means the caller supplied the complete empty set.
    return this.saveDraftInternal(input);
  }

  async saveDraft(input: {
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
    memoOverrides: ReadonlyArray<WorkInstructionMemoOverrideInput>;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView> {
    return this.saveDraftInternal(input);
  }

  private async saveDraftInternal(input: {
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
    memoOverrides?: ReadonlyArray<WorkInstructionMemoOverrideInput>;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView> {
    return this.db.$transaction(async (tx) => {
      const observed = await findRevisionWithSource(tx, input.revisionId);
      if (!observed) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      // All mutating revision operations lock publication → source version →
      // revision.  This makes the optimistic check and the replacement write
      // one serialized critical section; two writers cannot both succeed with
      // the same expected editVersion.
      await lockPublicationForVersion(tx, observed.sourceVersionId);
      await lockSourceVersion(tx, observed.sourceVersionId);
      await lockRevision(tx, input.revisionId);
      const revision = await findRevisionWithSource(tx, input.revisionId);
      if (!revision) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      const beforeView = toEditRevisionView(revision);
      const audit = await this.auditContextForRevision(tx, {
        authenticationId: input.editorAuthenticationId,
        clientDeviceId: input.clientDeviceId,
        requestId: input.requestId
      }, revision);
      const publication = await tx.workInstructionSourcePublication.findFirst({ where: { rowId: revision.sourceVersion.rowId } });
      if (!publication || publication.latestVersionId !== revision.sourceVersionId || input.expectedSourceVersionId !== publication.latestVersionId || input.expectedContentHash !== revision.sourceVersion.contentHash) {
        conflict('原本が再取込されています。最新版を再読込して注記を再適用してください', 'WORK_INSTRUCTION_SOURCE_CONFLICT', { latestVersionId: publication?.latestVersionId ?? null, currentContentHash: revision.sourceVersion.contentHash });
      }
      if (revision.status !== 'DRAFT' || !revision.isRevisionHead) conflict('最新版の下書きだけ保存できます', 'WORK_INSTRUCTION_REVISION_NOT_EDITABLE');
      if (revision.editVersion !== input.expectedEditVersion) conflict('注記が他の編集で更新されています', 'WORK_INSTRUCTION_EDIT_CONFLICT', { currentEditVersion: revision.editVersion });
      const normalized = normalizeElementsForVersion(revision.sourceVersion, input.elements);
      const normalizedMemos = input.memoOverrides === undefined
        ? undefined
        : normalizeMemoOverridesForVersion(revision.sourceVersion, input.memoOverrides, toEditRevisionView(revision).memoOverrides ?? []);
      const imageAssetIds = [...new Set(normalized.filter((element): element is Extract<WorkInstructionOverlayElement, { kind: 'IMAGE' }> => element.kind === 'IMAGE').map((element) => element.assetId))];
      if (imageAssetIds.length > 0) {
        const assets = await tx.workInstructionEditAsset.findMany({ where: { id: { in: imageAssetIds }, status: { in: ['STAGED', 'ACTIVE'] } } });
        if (assets.length !== imageAssetIds.length) throw new WorkInstructionEditingError(400, 'overlay画像assetが存在しません', 'WORK_INSTRUCTION_EDIT_ASSET_NOT_FOUND');
        const conflicting = assets.find((asset) => asset.ownerRevisionId && asset.ownerRevisionId !== revision.id);
        if (conflicting) conflict('別の下書きが保持しているoverlay画像は使用できません', 'WORK_INSTRUCTION_EDIT_ASSET_LEASE_CONFLICT', { assetId: conflicting.id });
      }
      const oldImageAssetIds = [...new Set(revision.overlays.filter((overlay) => overlay.kind === 'IMAGE').map((overlay) => overlay.editAssetId).filter((id): id is string => Boolean(id)))];
      await tx.workInstructionEditOverlay.deleteMany({ where: { revisionId: revision.id } });
      if (normalized.length > 0) await tx.workInstructionEditOverlay.createMany({ data: normalized.map((element) => overlayToCreateData(revision.id, element)) });
      if (imageAssetIds.length > 0) await tx.workInstructionEditAsset.updateMany({ where: { id: { in: imageAssetIds } }, data: { status: 'ACTIVE', ownerRevisionId: null, activatedAt: new Date() } });
      const replaced = oldImageAssetIds.filter((id) => !imageAssetIds.includes(id));
      if (replaced.length > 0) await tx.workInstructionEditAsset.updateMany({ where: { id: { in: replaced }, overlays: { none: {} } }, data: { status: 'DELETE_PENDING', deletePendingAt: new Date(), ownerRevisionId: null } });
      if (normalizedMemos !== undefined) {
        await tx.workInstructionEditMemoOverride.deleteMany({ where: { revisionId: revision.id } });
        if (normalizedMemos.length > 0) {
          await tx.workInstructionEditMemoOverride.createMany({ data: normalizedMemos.map((memo) => memoOverrideToCreateData(revision.id, memo)) });
        }
      }
      await tx.workInstructionEditRevision.update({ where: { id: revision.id }, data: { editVersion: { increment: 1 } } });
      const saved = await tx.workInstructionEditRevision.findUnique({ where: { id: revision.id }, include: workInstructionEditRevisionInclude });
      if (!saved) throw new Error('saved work-instruction revision disappeared');
      const savedView = toEditRevisionView(saved);
      await this.appendAudit(tx, {
        audit,
        action: 'SAVED',
        rowId: revision.sourceVersion.rowId,
        sourceVersionId: revision.sourceVersionId,
        revisionId: revision.id,
        editVersionBefore: revision.editVersion,
        editVersionAfter: savedView.editVersion,
        changeSet: revisionChangeSet(beforeView, {
          overlays: savedView.overlays,
          memoOverrides: savedView.memoOverrides ?? []
        })
      });
      return savedView;
    });
  }

  async applyRoiRebase(input: {
    revisionId: string;
    expectedEditVersion: number;
    updates: ReadonlyArray<{
      overlayId: string;
      editAssetId?: string;
      sourceStep: number | null;
      migrationState: 'MIGRATED' | 'NEEDS_REVIEW' | 'UNASSIGNED' | 'SKIPPED';
      targetStepFingerprint?: string | null;
    }>;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView> {
    return this.db.$transaction(async (tx) => {
      const observed = await tx.workInstructionEditRevision.findUnique({
        where: { id: input.revisionId },
        select: { id: true, sourceVersionId: true }
      });
      if (!observed) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      await lockPublicationForVersion(tx, observed.sourceVersionId);
      await lockSourceVersion(tx, observed.sourceVersionId);
      await lockRevision(tx, input.revisionId);
      const revision = await tx.workInstructionEditRevision.findUnique({
        where: { id: input.revisionId },
        include: {
          ...workInstructionEditRevisionInclude,
          sourceVersion: { include: workInstructionSourceVersionInclude }
        }
      });
      if (!revision) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      const beforeView = toEditRevisionView(revision);
      const audit = await this.auditContextForRevision(tx, {
        authenticationId: input.editorAuthenticationId,
        clientDeviceId: input.clientDeviceId,
        requestId: input.requestId
      }, revision);
      if (revision.status !== 'DRAFT' || !revision.isRevisionHead) conflict('最新版の下書きだけ更新できます', 'WORK_INSTRUCTION_REVISION_NOT_EDITABLE');
      if (revision.editVersion !== input.expectedEditVersion) conflict('注記が他の編集で更新されています', 'WORK_INSTRUCTION_EDIT_CONFLICT', { currentEditVersion: revision.editVersion });
      const byId = new Map(revision.overlays.map((overlay) => [overlay.id, overlay]));
      const updateIds = new Set<string>();
      for (const update of input.updates) {
        if (updateIds.has(update.overlayId)) throw new WorkInstructionEditingError(400, '同じoverlayを複数回更新できません', 'WORK_INSTRUCTION_DUPLICATE_OVERLAY');
        updateIds.add(update.overlayId);
        const overlay = byId.get(update.overlayId);
        if (!overlay) notFound('overlayが見つかりません', 'WORK_INSTRUCTION_OVERLAY_NOT_FOUND');
        if (update.sourceStep === null && update.migrationState !== 'UNASSIGNED' && update.migrationState !== 'SKIPPED') {
          throw new WorkInstructionEditingError(400, '未割当overlayのmigration stateが不正です', 'WORK_INSTRUCTION_OVERLAY_MIGRATION_STATE_INVALID');
        }
        if (update.sourceStep !== null && (update.migrationState === 'UNASSIGNED' || update.migrationState === 'SKIPPED')) {
          throw new WorkInstructionEditingError(400, '割当済みoverlayのmigration stateが不正です', 'WORK_INSTRUCTION_OVERLAY_MIGRATION_STATE_INVALID');
        }
        if (update.editAssetId !== undefined) {
          const asset = await tx.workInstructionEditAsset.findFirst({ where: { id: update.editAssetId, status: 'ACTIVE' } });
          if (!asset) notFound('ROI再生成assetが見つかりません', 'WORK_INSTRUCTION_EDIT_ASSET_NOT_FOUND');
          if (asset.ownerRevisionId !== revision.id) conflict('ROI再生成assetの所有者が不正です', 'WORK_INSTRUCTION_EDIT_ASSET_LEASE_CONFLICT');
        }
      }
      for (const update of input.updates) {
        const overlay = byId.get(update.overlayId)!;
        await tx.workInstructionEditOverlay.update({
          where: { id: overlay.id },
          data: {
            editAssetId: update.editAssetId ?? overlay.editAssetId,
            sourceStep: update.sourceStep === null ? null : BigInt(update.sourceStep),
            migrationState: update.migrationState,
            targetStepFingerprint: update.targetStepFingerprint === undefined ? overlay.targetStepFingerprint : update.targetStepFingerprint
          }
        });
        if (update.editAssetId !== undefined) {
          await tx.workInstructionEditAsset.update({ where: { id: update.editAssetId }, data: { ownerRevisionId: null } });
        }
      }
      if (input.updates.length > 0) {
        await tx.workInstructionEditRevision.update({ where: { id: revision.id }, data: { editVersion: { increment: 1 } } });
      }
      const saved = await tx.workInstructionEditRevision.findUnique({ where: { id: revision.id }, include: workInstructionEditRevisionInclude });
      if (!saved) throw new Error('ROI rebase revision disappeared');
      const savedView = toEditRevisionView(saved);
      await this.appendAudit(tx, {
        audit,
        action: 'SAVED',
        rowId: revision.sourceVersion.rowId,
        sourceVersionId: revision.sourceVersionId,
        revisionId: revision.id,
        editVersionBefore: revision.editVersion,
        editVersionAfter: savedView.editVersion,
        changeSet: {
          reason: 'ROI_REBASE',
          updatedOverlayIds: input.updates.map((update) => update.overlayId),
          ...revisionChangeSet(beforeView, {
            overlays: savedView.overlays,
            memoOverrides: savedView.memoOverrides ?? []
          })
        }
      });
      return savedView;
    });
  }

  async publishRevision(input: WorkInstructionPublishRevisionInput): Promise<WorkInstructionPublishRevisionResult> {
    const [published] = await this.publishRevisionGroup([input]);
    if (!published) throw new Error('published work-instruction revision disappeared');
    return published;
  }

  async publishRevisionGroup(
    inputs: ReadonlyArray<WorkInstructionPublishRevisionInput>,
    expectedGroup?: WorkInstructionGroupIdentity,
    authorization?: WorkInstructionEditorAuthorization
  ): Promise<ReadonlyArray<WorkInstructionPublishRevisionResult>> {
    if (inputs.length === 0) return [];
    const revisionIds = inputs.map((input) => input.revisionId);
    if (new Set(revisionIds).size !== revisionIds.length) {
      throw new WorkInstructionEditingError(400, '同じ改版を複数回指定できません', 'WORK_INSTRUCTION_DUPLICATE_REVISION');
    }
    return this.db.$transaction(async (tx) => {
      // Lock publication rows in row-id order. Delete requests use the same
      // order, so a concurrent publish/delete cannot split a publication.
      await tx.$queryRaw(Prisma.sql`
        SELECT publication."rowId"
        FROM "WorkInstructionSourcePublication" AS publication
        JOIN "WorkInstructionSourceVersion" AS version
          ON version."rowId" = publication."rowId"
        JOIN "WorkInstructionEditRevision" AS revision
          ON revision."sourceVersionId" = version."id"
        WHERE revision."id" IN (${Prisma.join(revisionIds)})
        ORDER BY publication."rowId" ASC
        FOR UPDATE OF publication
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "WorkInstructionSourceVersion"
        WHERE "id" IN (
          SELECT "sourceVersionId" FROM "WorkInstructionEditRevision" WHERE "id" IN (${Prisma.join(revisionIds)})
        )
        ORDER BY "id" ASC
        FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "WorkInstructionEditRevision"
        WHERE "id" IN (${Prisma.join(revisionIds)})
        ORDER BY "id" ASC
        FOR UPDATE
      `);

      const revisions = await Promise.all(revisionIds.map((revisionId) => findRevisionWithSource(tx, revisionId)));
      const byId = new Map(revisions.filter((revision): revision is NonNullable<typeof revision> => Boolean(revision)).map((revision) => [revision.id, revision]));
      if (byId.size !== revisionIds.length) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      const rowIds = new Set<string>();
      const results = new Map<string, WorkInstructionPublishRevisionResult>();
      for (const input of inputs) {
        const revision = byId.get(input.revisionId);
        if (!revision) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
        if (rowIds.has(revision.sourceVersion.rowId)) {
          conflict('同じ作業要領グループの改版を複数指定できません', 'WORK_INSTRUCTION_DUPLICATE_ROW_REVISION');
        }
        rowIds.add(revision.sourceVersion.rowId);
        await lockPublicationForVersion(tx, revision.sourceVersionId);
        const publication = await tx.workInstructionSourcePublication.findUnique({ where: { rowId: revision.sourceVersion.rowId } });
        const publishedVersion = publication?.publishedVersionId === revision.sourceVersionId
          ? revision.sourceVersion
          : publication
            ? await tx.workInstructionSourceVersion.findUnique({
              where: { id: publication.publishedVersionId },
              select: { partNumber: true, shootingTarget: true }
            })
            : null;
        assertGroupMembership(revision.sourceVersion, publishedVersion, expectedGroup);
        const audit = await this.auditContextForRevision(tx, {
          authenticationId: input.editorAuthenticationId ?? authorization?.authenticationId,
          clientDeviceId: input.clientDeviceId ?? authorization?.clientDeviceId,
          requestId: input.requestId ?? authorization?.requestId
        }, revision);
        if (!publication || publication.latestVersionId !== revision.sourceVersionId
          || (input.expectedSourceVersionId !== undefined && input.expectedSourceVersionId !== publication.latestVersionId)
          || (input.expectedContentHash !== undefined && input.expectedContentHash !== revision.sourceVersion.contentHash)) {
          conflict('原本が再取込されています。最新版を再読込して注記を再適用してください', 'WORK_INSTRUCTION_SOURCE_CONFLICT', { latestVersionId: publication?.latestVersionId ?? null, currentContentHash: revision.sourceVersion.contentHash });
        }
        if (revision.status !== 'DRAFT' || !revision.isRevisionHead) conflict('最新版の下書きだけ公開できます', 'WORK_INSTRUCTION_REVISION_NOT_EDITABLE');
        if (revision.editVersion !== input.expectedEditVersion) conflict('注記が他の編集で更新されています', 'WORK_INSTRUCTION_EDIT_CONFLICT', { currentEditVersion: revision.editVersion });
        const revisionView = toEditRevisionView(revision);
        const migration = migrationSummary(revisionView.overlays, revisionView.memoOverrides ?? []);
        if (migration.unassignedCount > 0 && !input.confirmUnassigned) {
          conflict('未割当の注記があります。確認して公開してください', 'WORK_INSTRUCTION_UNASSIGNED_OVERLAY_CONFIRMATION_REQUIRED', migration);
        }
        if (migration.memo.needsReviewCount > 0 || migration.memo.unassignedCount > 0) {
          conflict('memoの移植状態をKEEPまたはUSE_SOURCEで解決してから公開してください', 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED', migration);
        }
        await tx.workInstructionEditRevision.update({ where: { id: revision.id }, data: { status: 'PUBLISHED' } });
        await tx.workInstructionSourcePublication.update({ where: { rowId: revision.sourceVersion.rowId }, data: { publishedVersionId: revision.sourceVersionId, publishedRevisionId: revision.id } });
        const published = await tx.workInstructionEditRevision.findUnique({ where: { id: revision.id }, include: workInstructionEditRevisionInclude });
        if (!published) throw new Error('published work-instruction revision disappeared');
        const publishedView = toEditRevisionView(published);
        await this.appendAudit(tx, {
          audit,
          action: 'PUBLISHED',
          rowId: revision.sourceVersion.rowId,
          sourceVersionId: revision.sourceVersionId,
          revisionId: revision.id,
          editVersionBefore: revision.editVersion,
          editVersionAfter: publishedView.editVersion,
          changeSet: { statusBefore: 'DRAFT', statusAfter: 'PUBLISHED' }
        });
        results.set(input.revisionId, { revision: publishedView, migration });
      }
      return inputs.map((input) => {
        const result = results.get(input.revisionId);
        if (!result) throw new Error('published work-instruction revision result disappeared');
        return result;
      });
    }, { timeout: 30000 });
  }

  async discardRevision(input: {
    revisionId: string;
    expectedEditVersion?: number;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView> {
    return this.db.$transaction(async (tx) => {
      const observed = await tx.workInstructionEditRevision.findUnique({
        where: { id: input.revisionId },
        select: { id: true, sourceVersionId: true }
      });
      if (!observed) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      await lockPublicationForVersion(tx, observed.sourceVersionId);
      await lockSourceVersion(tx, observed.sourceVersionId);
      await lockRevision(tx, input.revisionId);
      const revision = await tx.workInstructionEditRevision.findUnique({
        where: { id: input.revisionId },
        include: {
          ...workInstructionEditRevisionInclude,
          sourceVersion: { include: workInstructionSourceVersionInclude }
        }
      });
      if (!revision) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      const beforeView = toEditRevisionView(revision);
      const audit = await this.auditContextForRevision(tx, {
        authenticationId: input.editorAuthenticationId,
        clientDeviceId: input.clientDeviceId,
        requestId: input.requestId
      }, revision);
      if (revision.status !== 'DRAFT' || !revision.isRevisionHead) conflict('最新版の下書きだけ破棄できます', 'WORK_INSTRUCTION_REVISION_NOT_EDITABLE');
      if (input.expectedEditVersion != null && input.expectedEditVersion !== revision.editVersion) conflict('注記が他の編集で更新されています', 'WORK_INSTRUCTION_EDIT_CONFLICT', { currentEditVersion: revision.editVersion });
      const assetIds = revision.overlays.filter((overlay) => overlay.kind === 'IMAGE').map((overlay) => overlay.editAssetId).filter((id): id is string => Boolean(id));
      await tx.workInstructionEditRevision.update({ where: { id: revision.id }, data: { isRevisionHead: false, status: 'DISCARDED' } });
      await tx.workInstructionEditOverlay.deleteMany({ where: { revisionId: revision.id } });
      await tx.workInstructionEditMemoOverride.deleteMany({ where: { revisionId: revision.id } });
      if (assetIds.length > 0) await tx.workInstructionEditAsset.updateMany({ where: { id: { in: [...new Set(assetIds)] }, overlays: { none: {} } }, data: { status: 'DELETE_PENDING', deletePendingAt: new Date(), ownerRevisionId: null } });
      const discarded = await tx.workInstructionEditRevision.findUnique({ where: { id: revision.id }, include: workInstructionEditRevisionInclude });
      if (!discarded) throw new Error('discarded work-instruction revision disappeared');
      const discardedView = toEditRevisionView(discarded);
      await this.appendAudit(tx, {
        audit,
        action: 'DISCARDED',
        rowId: revision.sourceVersion.rowId,
        sourceVersionId: revision.sourceVersionId,
        revisionId: revision.id,
        editVersionBefore: revision.editVersion,
        editVersionAfter: discardedView.editVersion,
        changeSet: {
          statusBefore: 'DRAFT',
          statusAfter: 'DISCARDED',
          ...revisionChangeSet(beforeView, { overlays: [], memoOverrides: [] })
        }
      });
      return discardedView;
    });
  }

  async stageEditAsset(input: {
    revisionId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    origin?: WorkInstructionEditAssetOriginInput;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
  }): Promise<WorkInstructionEditAssetView> {
    return this.db.$transaction(async (tx) => {
      const revision = await findRevisionWithSource(tx, input.revisionId);
      if (!revision) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      await this.auditContextForRevision(tx, {
        authenticationId: input.editorAuthenticationId,
        clientDeviceId: input.clientDeviceId
      }, revision);
      if (revision.status !== 'DRAFT' || !revision.isRevisionHead) conflict('最新版の下書きだけassetを追加できます', 'WORK_INSTRUCTION_REVISION_NOT_EDITABLE');
      const origin = input.origin?.origin ?? 'UPLOAD';
      const isRoi = origin === 'ROI';
      if (isRoi && (!input.origin?.sourceVersionId || input.origin.sourceStep == null || !input.origin.bbox)) {
        throw new WorkInstructionEditingError(400, 'ROI assetの原本provenanceが不足しています', 'WORK_INSTRUCTION_EDIT_ASSET_PROVENANCE_REQUIRED');
      }
      const bbox = input.origin?.bbox;
      const asset = await tx.workInstructionEditAsset.create({ data: {
        id: randomUUID(),
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        status: 'STAGED',
        origin,
        originSourceVersionId: isRoi ? input.origin?.sourceVersionId ?? null : null,
        originSourceStep: isRoi ? BigInt(input.origin?.sourceStep ?? 0) : null,
        originXRatio: isRoi ? bbox?.xRatio ?? null : null,
        originYRatio: isRoi ? bbox?.yRatio ?? null : null,
        originWidthRatio: isRoi ? bbox?.widthRatio ?? null : null,
        originHeightRatio: isRoi ? bbox?.heightRatio ?? null : null,
        ownerRevisionId: input.revisionId
      } });
      return toEditAssetView(asset);
    });
  }

  async activateEditAsset(input: {
    assetId: string;
    revisionId: string;
    action?: WorkInstructionEditAuditAction;
    authorization?: WorkInstructionEditorAuthorization;
  }): Promise<WorkInstructionEditAssetView> {
    return this.db.$transaction(async (tx) => {
      const revision = await findRevisionWithSource(tx, input.revisionId);
      if (!revision) notFound('作業要領改版が見つかりません', 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
      const audit = await this.auditContextForRevision(tx, input.authorization, revision);
      const result = await tx.workInstructionEditAsset.updateMany({ where: { id: input.assetId, ownerRevisionId: input.revisionId, status: 'STAGED' }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      if (result.count !== 1) notFound('編集assetが見つかりません', 'WORK_INSTRUCTION_EDIT_ASSET_NOT_FOUND');
      const asset = await tx.workInstructionEditAsset.findUnique({ where: { id: input.assetId } });
      if (!asset) notFound('編集assetが見つかりません', 'WORK_INSTRUCTION_EDIT_ASSET_NOT_FOUND');
      await this.appendAudit(tx, {
        audit,
        action: input.action ?? 'ASSET_UPLOADED',
        rowId: revision.sourceVersion.rowId,
        sourceVersionId: revision.sourceVersionId,
        revisionId: revision.id,
        changeSet: {
          assetId: asset.id,
          origin: asset.origin,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          sha256: asset.sha256
        }
      });
      return toEditAssetView(asset);
    });
  }

  async releaseEditAsset(input: { assetId: string; revisionId: string }): Promise<WorkInstructionEditAssetView | null> {
    return this.db.$transaction(async (tx) => {
      const asset = await tx.workInstructionEditAsset.findFirst({
        where: { id: input.assetId, ownerRevisionId: input.revisionId, overlays: { none: {} } }
      });
      if (!asset) return null;
      await tx.workInstructionEditAsset.delete({ where: { id: asset.id } });
      return toEditAssetView(asset);
    });
  }

  async markEditAssetDeletePending(input: { assetId: string; revisionId: string }): Promise<void> {
    await this.db.workInstructionEditAsset.updateMany({
      where: { id: input.assetId, ownerRevisionId: input.revisionId, overlays: { none: {} } },
      data: {
        status: 'DELETE_PENDING',
        deletePendingAt: new Date(),
        ownerRevisionId: null
      }
    });
  }

  async readEditAsset(assetId: string): Promise<WorkInstructionEditAssetView | null> {
    const asset = await this.db.workInstructionEditAsset.findFirst({ where: { id: assetId, status: 'ACTIVE' } });
    return asset ? toEditAssetView(asset) : null;
  }

  async claimEditAssetCleanupCandidates(input: { now: Date; limit: number }): Promise<ReadonlyArray<WorkInstructionEditAssetCleanupCandidate>> {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 500) return [];
    const stagedCutoff = new Date(input.now.getTime() - EDIT_ASSET_MAX_AGE_MS);
    return this.db.$transaction(async (tx) => tx.$queryRaw<WorkInstructionEditAssetCleanupCandidate[]>(Prisma.sql`
      WITH candidates AS (
        SELECT asset."id"
        FROM "WorkInstructionEditAsset" AS asset
        WHERE (
          (asset."status" = 'STAGED' AND asset."createdAt" <= ${stagedCutoff})
          OR (asset."status" = 'DELETE_PENDING' AND
            (asset."deletePendingAt" IS NULL OR asset."deletePendingAt" <= ${input.now}))
          OR (
            asset."status" = 'ACTIVE'
            AND (
              asset."ownerRevisionId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "WorkInstructionEditRevision" AS owner_revision
                WHERE owner_revision."id" = asset."ownerRevisionId"
                  AND (owner_revision."status" <> 'DRAFT' OR owner_revision."isRevisionHead" = false)
              )
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM "WorkInstructionEditOverlay" AS overlay
          WHERE overlay."editAssetId" = asset."id"
        )
        ORDER BY asset."createdAt" ASC, asset."id" ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE "WorkInstructionEditAsset" AS asset
        SET "status" = 'DELETE_PENDING',
            "ownerRevisionId" = NULL,
            "deletePendingAt" = COALESCE(asset."deletePendingAt", ${input.now}),
            "lastDeleteError" = NULL,
            "updatedAt" = ${input.now}
        FROM candidates
        WHERE asset."id" = candidates."id"
        RETURNING asset."id" AS "assetId", asset."storageKey", asset."createdAt", asset."deletePendingAt"
      )
      SELECT "assetId", "storageKey", "createdAt", "deletePendingAt"
      FROM claimed
      ORDER BY "createdAt" ASC, "assetId" ASC
    `));
  }

  async deleteEditAssetRecord(input: { assetId: string }): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const result = await tx.workInstructionEditAsset.deleteMany({
        where: { id: input.assetId, status: 'DELETE_PENDING', overlays: { none: {} } }
      });
      return result.count === 1;
    });
  }

  async recordEditAssetDeletionFailure(input: { assetId: string; error: string }): Promise<void> {
    await this.db.workInstructionEditAsset.updateMany({
      where: { id: input.assetId, status: 'DELETE_PENDING' },
      data: {
        lastDeleteError: input.error.slice(0, 2000),
        deletePendingAt: new Date()
      }
    });
  }

  async requestSourceAssetDeletion(input: {
    sourceVersionId: string;
    assetId: string;
    requestedBy: string;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<{ auditId: string; assetId: string; storageKey: string; sha256: string; status: 'REQUESTED' | 'DELETED' | 'FAILED' }> {
    return this.db.$transaction(async (tx) => {
      // Lock in the same order as group publication: publication, source
      // version, then asset. A repeated request observes the existing audit
      // instead of creating a second tombstone.
      await lockPublicationForVersion(tx, input.sourceVersionId);
      await lockSourceVersion(tx, input.sourceVersionId);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "WorkInstructionAsset" WHERE "id" = ${input.assetId} FOR UPDATE
      `);
      const version = await tx.workInstructionSourceVersion.findUnique({ where: { id: input.sourceVersionId }, include: { steps: true } });
      if (!version) notFound('原本版が見つかりません', 'WORK_INSTRUCTION_SOURCE_VERSION_NOT_FOUND');
      const auditContext = await this.auditContextForSourceVersion(tx, {
        authenticationId: input.editorAuthenticationId,
        clientDeviceId: input.clientDeviceId,
        requestId: input.requestId
      }, version);
      const prior = await tx.workInstructionSourceAssetDeletionAudit.findFirst({
        where: { sourceVersionId: input.sourceVersionId, assetId: input.assetId },
        orderBy: { requestedAt: 'desc' }
      });
      if (prior) {
        return {
          auditId: prior.id,
          assetId: prior.assetId,
          storageKey: prior.storageKey,
          sha256: prior.sha256,
          status: prior.status
        };
      }
      const refs = version.steps.filter((step) => step.imageAssetId === input.assetId);
      if (refs.length === 0) notFound('原本画像が対象版にありません', 'WORK_INSTRUCTION_SOURCE_ASSET_NOT_FOUND');
      const publication = await tx.workInstructionSourcePublication.findUnique({ where: { rowId: version.rowId } });
      if (publication?.latestVersionId === version.id || publication?.publishedVersionId === version.id) conflict('公開中または最新版の原本画像は削除できません', 'WORK_INSTRUCTION_SOURCE_ASSET_IN_USE');
      const draft = await tx.workInstructionEditRevision.findFirst({ where: { sourceVersionId: version.id, status: 'DRAFT', isRevisionHead: true } });
      if (draft) conflict('編集中の原本画像は削除できません', 'WORK_INSTRUCTION_SOURCE_ASSET_IN_USE');
      const allRefs = await tx.workInstructionSourceVersionStep.findMany({ where: { imageAssetId: input.assetId }, select: { sourceVersionId: true } });
      if (allRefs.some((ref) => ref.sourceVersionId !== version.id)) conflict('複数の原本版から参照されている画像です', 'WORK_INSTRUCTION_SOURCE_ASSET_IN_USE');
      const currentRefs = await tx.workInstructionStep.count({ where: { assetId: input.assetId } });
      if (currentRefs > 0) conflict('最新原本から参照されている画像です', 'WORK_INSTRUCTION_SOURCE_ASSET_IN_USE');
      const asset = await tx.workInstructionAsset.findUnique({ where: { id: input.assetId } });
      if (!asset) notFound('原本画像assetが見つかりません', 'WORK_INSTRUCTION_SOURCE_ASSET_NOT_FOUND');
      const requestedBy = auditContext?.context.employeeNameSnapshot ?? input.requestedBy;
      const audit = await tx.workInstructionSourceAssetDeletionAudit.create({ data: { id: randomUUID(), assetId: asset.id, sourceVersionId: version.id, storageKey: asset.storageKey, sha256: asset.sha256, requestedBy, status: 'REQUESTED' } });
      await tx.workInstructionSourceVersionStep.updateMany({ where: { sourceVersionId: version.id, imageAssetId: asset.id }, data: { imageAssetId: null, imageDeletedAt: new Date(), imageDeletedBy: requestedBy } });
      await tx.workInstructionAsset.update({ where: { id: asset.id }, data: { status: 'DELETE_PENDING', deletePendingAt: new Date() } });
      return { auditId: audit.id, assetId: asset.id, storageKey: asset.storageKey, sha256: asset.sha256, status: audit.status };
    });
  }

  async completeSourceAssetDeletion(input: {
    auditId: string;
    assetId: string;
    authorization: RequiredWorkInstructionEditorAuthorization;
  }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "WorkInstructionSourceAssetDeletionAudit" WHERE "id" = ${input.auditId} FOR UPDATE
      `);
      const audit = await tx.workInstructionSourceAssetDeletionAudit.findUnique({ where: { id: input.auditId } });
      if (!audit) notFound('原本画像削除監査が見つかりません', 'WORK_INSTRUCTION_SOURCE_ASSET_DELETION_NOT_FOUND');
      if (audit.assetId !== input.assetId) conflict('原本画像削除監査とassetが一致しません', 'WORK_INSTRUCTION_SOURCE_ASSET_DELETION_MISMATCH');
      if (audit.status === 'DELETED') return;
      await lockPublicationForVersion(tx, audit.sourceVersionId);
      await lockSourceVersion(tx, audit.sourceVersionId);
      const version = await tx.workInstructionSourceVersion.findUnique({
        where: { id: audit.sourceVersionId },
        select: { id: true, rowId: true, partNumber: true, shootingTarget: true }
      });
      if (!version) notFound('原本版が見つかりません', 'WORK_INSTRUCTION_SOURCE_VERSION_NOT_FOUND');
      const auditContext = await this.auditContextForSourceVersion(tx, input.authorization, version);
      if (!auditContext) authRequired();
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "WorkInstructionAsset" WHERE "id" = ${input.assetId} FOR UPDATE
      `);
      const asset = await tx.workInstructionAsset.findUnique({ where: { id: input.assetId } });
      if (!asset) {
        await tx.workInstructionSourceAssetDeletionAudit.update({ where: { id: audit.id }, data: { status: 'DELETED', completedAt: new Date(), error: null } });
        await this.appendAudit(tx, {
          audit: auditContext,
          action: 'SOURCE_IMAGE_DELETED',
          rowId: version.rowId,
          sourceVersionId: version.id,
          changeSet: {
            assetId: audit.assetId,
            storageKey: audit.storageKey,
            sha256: audit.sha256,
            status: 'DELETED',
            deletionAuditId: audit.id
          }
        });
        return;
      }
      if (asset.status !== 'DELETE_PENDING') conflict('原本画像が削除待ちではありません', 'WORK_INSTRUCTION_SOURCE_ASSET_IN_USE');
      const refs = await tx.workInstructionSourceVersionStep.count({ where: { imageAssetId: input.assetId } });
      const currentRefs = await tx.workInstructionStep.count({ where: { assetId: input.assetId } });
      if (refs > 0 || currentRefs > 0) conflict('原本画像がまだ参照されています', 'WORK_INSTRUCTION_SOURCE_ASSET_IN_USE');
      await tx.workInstructionAsset.delete({ where: { id: input.assetId } });
      await tx.workInstructionSourceAssetDeletionAudit.update({ where: { id: audit.id }, data: { status: 'DELETED', completedAt: new Date(), error: null } });
      await this.appendAudit(tx, {
        audit: auditContext,
        action: 'SOURCE_IMAGE_DELETED',
        rowId: version.rowId,
        sourceVersionId: version.id,
        changeSet: {
          assetId: audit.assetId,
          storageKey: audit.storageKey,
          sha256: audit.sha256,
          status: 'DELETED',
          deletionAuditId: audit.id
        }
      });
    });
  }

  async failSourceAssetDeletion(input: { auditId: string; error: string }): Promise<void> {
    await this.db.workInstructionSourceAssetDeletionAudit.updateMany({ where: { id: input.auditId, status: { not: 'DELETED' } }, data: { status: 'FAILED', error: input.error.slice(0, 2000) } });
  }
}
