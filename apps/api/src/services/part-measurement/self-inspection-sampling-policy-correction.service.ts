import { Prisma, type PrismaClient, type SelfInspectionMode } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { acquireThreeKeyLineageTransactionLock } from './part-measurement-template-lineage-lock.js';
import { PartMeasurementTemplateService } from './part-measurement-template.service.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from './self-inspection-machine-board-cache-invalidation.js';

type CorrectionDb = PrismaClient | Prisma.TransactionClient;

export type SelfInspectionSamplingPolicyCorrectionTarget = {
  correctionKey: string;
  templateId: string;
  fhincd: string;
  processGroup: 'CUTTING' | 'GRINDING';
  resourceCd: string;
  sourceVersion: number;
  expectedInitialEntryCount: number;
  expectedSessionIds: readonly [string, string];
  populatedSessionId: string;
  emptySessionId: string;
  expectedTemplateItemCount: number;
  expectedOperatorValueCount: number;
  expectedInspectorValueCount: number;
  expectedFinalReviewCount: number;
  expectedFinalJudgementCount: number;
};

export type SelfInspectionSamplingPolicyCorrectionPhase =
  | 'pending'
  | 'revision_created'
  | 'applied';

type TemplateItemSnapshot = {
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  displayMarker: string | null;
  unit: string | null;
  allowNegative: boolean;
  decimalPlaces: number;
  markerXRatio: string | null;
  markerYRatio: string | null;
  calloutTipXRatio: string | null;
  calloutTipYRatio: string | null;
  nominalValue: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  depthMode: string;
  valueKind: string;
};

type CorrectionInspection = {
  phase: SelfInspectionSamplingPolicyCorrectionPhase;
  sourceTemplate: {
    id: string;
    version: number;
    isActive: boolean;
    selfInspectionMode: SelfInspectionMode;
    itemCount: number;
  };
  replacementTemplate: {
    id: string;
    version: number;
    selfInspectionMode: SelfInspectionMode;
    itemCount: number;
  } | null;
  sessions: Array<{
    id: string;
    productNo: string;
    expectedEntryCount: number;
    operatorEntryCount: number;
    inspectorEntryCount: number;
    operatorValueCount: number;
    inspectorValueCount: number;
  }>;
};

export type SelfInspectionSamplingPolicyCorrectionResult = CorrectionInspection & {
  correctionKey: string;
  dryRun: boolean;
  changed: boolean;
};

type PolicyOnlyTemplateReviser = {
  reviseSelfInspectionPolicyOnly(
    sourceTemplateId: string,
    input: {
      selfInspectionMode: SelfInspectionMode;
      selfInspectionFixedCount: number | null;
    }
  ): Promise<unknown>;
};

export class SelfInspectionSamplingPolicyCorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfInspectionSamplingPolicyCorrectionError';
  }
}

function fail(message: string): never {
  throw new SelfInspectionSamplingPolicyCorrectionError(message);
}

function decimalString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function templateItemSnapshots(
  items: Array<{
    sortOrder: number;
    datumSurface: string;
    measurementPoint: string;
    measurementLabel: string;
    displayMarker: string | null;
    unit: string | null;
    allowNegative: boolean;
    decimalPlaces: number;
    markerXRatio: unknown;
    markerYRatio: unknown;
    calloutTipXRatio: unknown;
    calloutTipYRatio: unknown;
    nominalValue: unknown;
    lowerLimit: unknown;
    upperLimit: unknown;
    depthMode: unknown;
    valueKind: unknown;
  }>
): TemplateItemSnapshot[] {
  return items
    .map((item) => ({
      sortOrder: item.sortOrder,
      datumSurface: item.datumSurface,
      measurementPoint: item.measurementPoint,
      measurementLabel: item.measurementLabel,
      displayMarker: item.displayMarker,
      unit: item.unit,
      allowNegative: item.allowNegative,
      decimalPlaces: item.decimalPlaces,
      markerXRatio: decimalString(item.markerXRatio),
      markerYRatio: decimalString(item.markerYRatio),
      calloutTipXRatio: decimalString(item.calloutTipXRatio),
      calloutTipYRatio: decimalString(item.calloutTipYRatio),
      nominalValue: decimalString(item.nominalValue),
      lowerLimit: decimalString(item.lowerLimit),
      upperLimit: decimalString(item.upperLimit),
      depthMode: String(item.depthMode),
      valueKind: String(item.valueKind)
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function assertSameTemplateContent(
  source: {
    name: string;
    templateScope: string;
    candidateFhinmei: string | null;
    visualTemplateId: string | null;
    siblingGroupId: string | null;
    items: Parameters<typeof templateItemSnapshots>[0];
  },
  replacement: {
    name: string;
    templateScope: string;
    candidateFhinmei: string | null;
    visualTemplateId: string | null;
    siblingGroupId: string | null;
    items: Parameters<typeof templateItemSnapshots>[0];
  }
): void {
  const sourceMeta = {
    name: source.name,
    templateScope: source.templateScope,
    candidateFhinmei: source.candidateFhinmei,
    visualTemplateId: source.visualTemplateId,
    siblingGroupId: source.siblingGroupId
  };
  const replacementMeta = {
    name: replacement.name,
    templateScope: replacement.templateScope,
    candidateFhinmei: replacement.candidateFhinmei,
    visualTemplateId: replacement.visualTemplateId,
    siblingGroupId: replacement.siblingGroupId
  };
  if (JSON.stringify(sourceMeta) !== JSON.stringify(replacementMeta)) {
    fail('v6のテンプレート属性がv5と一致しません');
  }
  if (
    JSON.stringify(templateItemSnapshots(source.items)) !==
    JSON.stringify(templateItemSnapshots(replacement.items))
  ) {
    fail('v6の測定点内容がv5と一致しません');
  }
}

async function loadInspection(
  db: CorrectionDb,
  target: SelfInspectionSamplingPolicyCorrectionTarget
): Promise<CorrectionInspection> {
  const source = await db.partMeasurementTemplate.findUnique({
    where: { id: target.templateId },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      selfInspectionSessions: {
        orderBy: { id: 'asc' },
        include: {
          entries: {
            orderBy: { entryIndex: 'asc' },
            include: { values: { orderBy: { id: 'asc' } } }
          },
          inspectorEntries: {
            orderBy: { entryIndex: 'asc' },
            include: { values: { orderBy: { id: 'asc' } } }
          },
          paperReports: { select: { id: true } }
        }
      }
    }
  });
  if (!source) fail('対象のv5テンプレートが見つかりません');
  if (
    source.fhincd !== target.fhincd ||
    source.processGroup !== target.processGroup ||
    source.resourceCd !== target.resourceCd ||
    source.version !== target.sourceVersion ||
    source.templateScope !== 'THREE_KEY' ||
    source.siblingGroupId !== null
  ) {
    fail('対象テンプレートのキー・版・スコープが想定と一致しません');
  }
  if (source.items.length !== target.expectedTemplateItemCount) {
    fail(`v5の測定点数が${target.expectedTemplateItemCount}件ではありません`);
  }

  const lineage = await db.partMeasurementTemplate.findMany({
    where: {
      fhincd: target.fhincd,
      processGroup: target.processGroup,
      resourceCd: target.resourceCd
    },
    orderBy: { version: 'asc' },
    include: { items: { orderBy: { sortOrder: 'asc' } } }
  });
  const unexpectedNewer = lineage.filter(
    (template) => template.version > target.sourceVersion + 1
  );
  if (unexpectedNewer.length > 0) {
    fail('想定外のv7以降のテンプレートが存在します');
  }
  const replacement =
    lineage.find(
      (template) =>
        template.version === target.sourceVersion + 1 && template.isActive
    ) ?? null;
  if (replacement) {
    if (
      replacement.selfInspectionMode !== 'SINGLE' ||
      replacement.selfInspectionFixedCount !== null ||
      replacement.selfInspectionSampleSize !== null
    ) {
      fail('有効なv6が抜き取り1個ではありません');
    }
    assertSameTemplateContent(source, replacement);
  }

  const actualSessionIds = source.selfInspectionSessions
    .map((session) => session.id)
    .sort();
  const expectedSessionIds = [...target.expectedSessionIds].sort();
  if (JSON.stringify(actualSessionIds) !== JSON.stringify(expectedSessionIds)) {
    fail('v5を参照するセッション集合が想定の2件と一致しません');
  }

  for (const session of source.selfInspectionSessions) {
    if (session.completedAt) fail(`完了済みセッションがあります: ${session.id}`);
    if (session.paperReports.length > 0) {
      fail(`紙帳票が発行済みのセッションがあります: ${session.id}`);
    }
    if (
      session.entries.some((entry) => entry.entryIndex > 0) ||
      session.inspectorEntries.some((entry) => entry.entryIndex > 0)
    ) {
      fail(`entryIndex 1以上の入力があります: ${session.id}`);
    }
  }

  const populated = source.selfInspectionSessions.find(
    (session) => session.id === target.populatedSessionId
  );
  const empty = source.selfInspectionSessions.find(
    (session) => session.id === target.emptySessionId
  );
  if (!populated || !empty) fail('入力済み／空セッションの識別に失敗しました');
  if (populated.entries.length !== 1 || populated.inspectorEntries.length !== 1) {
    fail('入力済みセッションの測定者／検査員入力件数が想定と一致しません');
  }
  const operatorValues = populated.entries[0]?.values ?? [];
  const inspectorValues = populated.inspectorEntries[0]?.values ?? [];
  if (
    operatorValues.length !== target.expectedOperatorValueCount ||
    inspectorValues.length !== target.expectedInspectorValueCount
  ) {
    fail('入力済みセッションの測定値件数が想定と一致しません');
  }
  if (
    operatorValues.filter((value) => value.finalReviewStatus != null).length !==
    target.expectedFinalReviewCount
  ) {
    fail('測定者NGの最終レビュー件数が想定と一致しません');
  }
  if (
    inspectorValues.filter((value) => value.finalJudgementStatus != null).length !==
    target.expectedFinalJudgementCount
  ) {
    fail('検査員の最終判定件数が想定と一致しません');
  }
  if (empty.entries.length !== 0 || empty.inspectorEntries.length !== 0) {
    fail('空であるべきセッションに入力があります');
  }

  const initialSessions = source.selfInspectionSessions.every(
    (session) =>
      session.expectedEntryCount === target.expectedInitialEntryCount &&
      session.entries.every((entry) => entry.entrySlotKind === 'FIXED') &&
      session.inspectorEntries.every((entry) => entry.entrySlotKind === 'FIXED')
  );
  const appliedSessions = source.selfInspectionSessions.every(
    (session) =>
      session.expectedEntryCount === 1 &&
      session.entries.every((entry) => entry.entrySlotKind === 'SINGLE') &&
      session.inspectorEntries.every((entry) => entry.entrySlotKind === 'SINGLE')
  );

  let phase: SelfInspectionSamplingPolicyCorrectionPhase;
  if (
    source.isActive &&
    source.selfInspectionMode === 'FULL' &&
    replacement === null &&
    initialSessions
  ) {
    phase = 'pending';
  } else if (
    !source.isActive &&
    source.selfInspectionMode === 'FULL' &&
    replacement !== null &&
    initialSessions
  ) {
    phase = 'revision_created';
  } else if (
    !source.isActive &&
    source.selfInspectionMode === 'SINGLE' &&
    source.selfInspectionFixedCount === null &&
    replacement !== null &&
    appliedSessions
  ) {
    phase = 'applied';
  } else {
    fail('テンプレートまたはセッションが想定外の中間状態です');
  }

  return {
    phase,
    sourceTemplate: {
      id: source.id,
      version: source.version,
      isActive: source.isActive,
      selfInspectionMode: source.selfInspectionMode,
      itemCount: source.items.length
    },
    replacementTemplate: replacement
      ? {
          id: replacement.id,
          version: replacement.version,
          selfInspectionMode: replacement.selfInspectionMode,
          itemCount: replacement.items.length
        }
      : null,
    sessions: source.selfInspectionSessions.map((session) => ({
      id: session.id,
      productNo: session.productNo,
      expectedEntryCount: session.expectedEntryCount,
      operatorEntryCount: session.entries.length,
      inspectorEntryCount: session.inspectorEntries.length,
      operatorValueCount: session.entries.reduce(
        (sum, entry) => sum + entry.values.length,
        0
      ),
      inspectorValueCount: session.inspectorEntries.reduce(
        (sum, entry) => sum + entry.values.length,
        0
      )
    }))
  };
}

async function measurementSnapshot(
  db: CorrectionDb,
  sessionIds: readonly string[]
): Promise<string> {
  const [operatorValues, inspectorValues] = await Promise.all([
    db.selfInspectionMeasurementValue.findMany({
      where: { entry: { sessionId: { in: [...sessionIds] } } },
      orderBy: { id: 'asc' }
    }),
    db.selfInspectionInspectorMeasurementValue.findMany({
      where: { inspectorEntry: { sessionId: { in: [...sessionIds] } } },
      orderBy: { id: 'asc' }
    })
  ]);
  return JSON.stringify({
    operatorValues: operatorValues.map((value) => ({
      id: value.id,
      entryId: value.entryId,
      templateItemId: value.templateItemId,
      value: decimalString(value.value),
      judgementResult: value.judgementResult,
      reviewStatus: value.reviewStatus,
      finalReviewStatus: value.finalReviewStatus,
      outOfToleranceAcknowledgedAt:
        value.outOfToleranceAcknowledgedAt?.toISOString() ?? null,
      approvedAt: value.approvedAt?.toISOString() ?? null,
      approvedByUserId: value.approvedByUserId,
      approvedByUsername: value.approvedByUsername,
      approvalComment: value.approvalComment
    })),
    inspectorValues: inspectorValues.map((value) => ({
      id: value.id,
      inspectorEntryId: value.inspectorEntryId,
      templateItemId: value.templateItemId,
      operatorMeasurementValueId: value.operatorMeasurementValueId,
      operatorValueSnapshot: decimalString(value.operatorValueSnapshot),
      inspectorValue: decimalString(value.inspectorValue),
      differenceValue: decimalString(value.differenceValue),
      judgementStatus: value.judgementStatus,
      finalJudgementStatus: value.finalJudgementStatus,
      judgedAt: value.judgedAt?.toISOString() ?? null,
      judgementComment: value.judgementComment
    }))
  });
}

export class SelfInspectionSamplingPolicyCorrectionService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly templateReviser: PolicyOnlyTemplateReviser =
      new PartMeasurementTemplateService()
  ) {}

  async inspect(
    target: SelfInspectionSamplingPolicyCorrectionTarget
  ): Promise<CorrectionInspection> {
    return loadInspection(this.db, target);
  }

  async run(
    target: SelfInspectionSamplingPolicyCorrectionTarget,
    options: { execute: boolean }
  ): Promise<SelfInspectionSamplingPolicyCorrectionResult> {
    let inspection = await loadInspection(this.db, target);
    if (!options.execute || inspection.phase === 'applied') {
      return {
        ...inspection,
        correctionKey: target.correctionKey,
        dryRun: !options.execute,
        changed: false
      };
    }

    if (inspection.phase === 'pending') {
      await this.templateReviser.reviseSelfInspectionPolicyOnly(target.templateId, {
        selfInspectionMode: 'SINGLE',
        selfInspectionFixedCount: null
      });
      inspection = await loadInspection(this.db, target);
    }
    if (inspection.phase !== 'revision_created') {
      fail('v6作成後の状態が補正可能ではありません');
    }

    await this.db.$transaction(async (tx) => {
      await acquireThreeKeyLineageTransactionLock(
        tx,
        target.fhincd,
        target.processGroup,
        target.resourceCd
      );
      await tx.$queryRaw`
        SELECT id
        FROM "PartMeasurementTemplate"
        WHERE id = ${target.templateId}
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT id
        FROM "SelfInspectionSession"
        WHERE id IN (${Prisma.join([...target.expectedSessionIds])})
        ORDER BY id
        FOR UPDATE
      `;

      const lockedInspection = await loadInspection(tx, target);
      if (lockedInspection.phase !== 'revision_created') {
        fail('ロック取得後の状態が補正可能ではありません');
      }
      const beforeValues = await measurementSnapshot(tx, target.expectedSessionIds);

      await tx.partMeasurementTemplate.update({
        where: { id: target.templateId },
        data: {
          selfInspectionMode: 'SINGLE',
          selfInspectionFixedCount: null,
          selfInspectionSampleSize: null
        }
      });
      const updatedSessions = await tx.selfInspectionSession.updateMany({
        where: {
          id: { in: [...target.expectedSessionIds] },
          completedAt: null,
          expectedEntryCount: target.expectedInitialEntryCount
        },
        data: { expectedEntryCount: 1 }
      });
      if (updatedSessions.count !== target.expectedSessionIds.length) {
        fail('自主検査セッション2件を安全に更新できませんでした');
      }
      const operatorEntries = await tx.selfInspectionLotEntry.updateMany({
        where: {
          sessionId: { in: [...target.expectedSessionIds] },
          entryIndex: 0,
          entrySlotKind: 'FIXED'
        },
        data: { entrySlotKind: 'SINGLE' }
      });
      if (operatorEntries.count !== 1) {
        fail('測定者入力件の更新件数が想定と一致しません');
      }
      const inspectorEntries = await tx.selfInspectionInspectorEntry.updateMany({
        where: {
          sessionId: { in: [...target.expectedSessionIds] },
          entryIndex: 0,
          entrySlotKind: 'FIXED'
        },
        data: { entrySlotKind: 'SINGLE' }
      });
      if (inspectorEntries.count !== 1) {
        fail('検査員入力件の更新件数が想定と一致しません');
      }

      const afterValues = await measurementSnapshot(tx, target.expectedSessionIds);
      if (beforeValues !== afterValues) {
        fail('補正中に測定値または最終判定が変化しました');
      }
      const afterInspection = await loadInspection(tx, target);
      if (afterInspection.phase !== 'applied') {
        fail('補正後の整合性検査に失敗しました');
      }
    });

    resetSelfInspectionMachineBoardScheduleRowCaches();
    const applied = await loadInspection(this.db, target);
    return {
      ...applied,
      correctionKey: target.correctionKey,
      dryRun: false,
      changed: true
    };
  }
}
