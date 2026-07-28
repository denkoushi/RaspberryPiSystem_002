import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  SelfInspectionSamplingPolicyCorrectionError,
  SelfInspectionSamplingPolicyCorrectionService,
  type SelfInspectionSamplingPolicyCorrectionTarget
} from '../self-inspection-sampling-policy-correction.service.js';

const SOURCE_TEMPLATE_ID = '11111111-1111-4111-8111-111111111115';
const POPULATED_SESSION_ID = '22222222-2222-4222-8222-222222222221';
const EMPTY_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const FHINCD = 'TEST-MD004121632';
const RESOURCE_CD = 'T021';

const target = {
  correctionKey: 'test-single-correction-v1',
  templateId: SOURCE_TEMPLATE_ID,
  fhincd: FHINCD,
  processGroup: 'CUTTING',
  resourceCd: RESOURCE_CD,
  sourceVersion: 5,
  expectedInitialEntryCount: 5,
  expectedSessionIds: [POPULATED_SESSION_ID, EMPTY_SESSION_ID],
  populatedSessionId: POPULATED_SESSION_ID,
  emptySessionId: EMPTY_SESSION_ID,
  expectedTemplateItemCount: 13,
  expectedOperatorValueCount: 13,
  expectedInspectorValueCount: 13,
  expectedFinalReviewCount: 1,
  expectedFinalJudgementCount: 1
} as const satisfies SelfInspectionSamplingPolicyCorrectionTarget;

async function cleanupFixture(): Promise<void> {
  await prisma.selfInspectionPaperReport.deleteMany({
    where: { sessionId: { in: [POPULATED_SESSION_ID, EMPTY_SESSION_ID] } }
  });
  await prisma.selfInspectionSession.deleteMany({
    where: { id: { in: [POPULATED_SESSION_ID, EMPTY_SESSION_ID] } }
  });
  await prisma.partMeasurementTemplate.deleteMany({
    where: { fhincd: FHINCD, resourceCd: RESOURCE_CD }
  });
}

async function seedFixture(): Promise<void> {
  const template = await prisma.partMeasurementTemplate.create({
    data: {
      id: SOURCE_TEMPLATE_ID,
      fhincd: FHINCD,
      processGroup: 'CUTTING',
      resourceCd: RESOURCE_CD,
      name: '補正テストテンプレート',
      version: 5,
      isActive: true,
      selfInspectionMode: 'FULL',
      items: {
        create: Array.from({ length: 13 }, (_, index) => ({
          sortOrder: index,
          datumSurface: 'A',
          measurementPoint: `P${index + 1}`,
          measurementLabel: `寸法${index + 1}`,
          displayMarker: String(index + 1),
          markerXRatio: String(0.1 + index * 0.01),
          markerYRatio: String(0.2 + index * 0.01),
          nominalValue: '10',
          lowerLimit: '9',
          upperLimit: '11',
          allowNegative: false,
          decimalPlaces: 2
        }))
      }
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } }
  });

  await prisma.selfInspectionSession.createMany({
    data: [
      {
        id: POPULATED_SESSION_ID,
        sessionBusinessKey: `correction-populated-${Date.now()}`,
        templateId: template.id,
        productNo: '0003958417',
        processGroup: 'CUTTING',
        resourceCd: RESOURCE_CD,
        scheduleRowId: 'row-populated',
        fseiban: 'FS-POPULATED',
        fhincd: FHINCD,
        fhinmei: 'ナットホルダー',
        plannedQuantity: 5,
        expectedEntryCount: 5,
        startedAt: new Date(),
        decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT'
      },
      {
        id: EMPTY_SESSION_ID,
        sessionBusinessKey: `correction-empty-${Date.now()}`,
        templateId: template.id,
        productNo: '0003749093',
        processGroup: 'CUTTING',
        resourceCd: RESOURCE_CD,
        scheduleRowId: 'row-empty',
        fseiban: 'FS-EMPTY',
        fhincd: FHINCD,
        fhinmei: 'ナットホルダー',
        plannedQuantity: 5,
        expectedEntryCount: 5,
        startedAt: new Date(),
        decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT'
      }
    ]
  });

  const operatorEntry = await prisma.selfInspectionLotEntry.create({
    data: {
      sessionId: POPULATED_SESSION_ID,
      entryIndex: 0,
      entrySlotKind: 'FIXED',
      persistenceStatus: 'CONFIRMED',
      createdByEmployeeNameSnapshot: '測定者A',
      measuringInstrumentManagementNumberSnapshot: 'MIC-001',
      measuringInstrumentNameSnapshot: '外側マイクロメータ',
      measuringInstrumentTagUidSnapshot: 'TAG-OPERATOR'
    }
  });
  await prisma.selfInspectionMeasurementValue.createMany({
    data: template.items.map((item, index) => ({
      entryId: operatorEntry.id,
      templateItemId: item.id,
      value: index === 0 ? '12' : '10',
      reviewStatus: index === 0 ? 'PENDING' : 'NOT_REQUIRED',
      finalReviewStatus: index === 0 ? 'APPROVED' : null,
      outOfToleranceAcknowledgedAt: index === 0 ? new Date('2026-07-28T00:00:00Z') : null,
      approvedAt: index === 0 ? new Date('2026-07-28T00:01:00Z') : null,
      approvedByUsername: index === 0 ? 'Inspector' : null
    }))
  });
  const operatorValues = await prisma.selfInspectionMeasurementValue.findMany({
    where: { entryId: operatorEntry.id },
    orderBy: { templateItem: { sortOrder: 'asc' } }
  });

  const inspectorEntry = await prisma.selfInspectionInspectorEntry.create({
    data: {
      sessionId: POPULATED_SESSION_ID,
      entryIndex: 0,
      entrySlotKind: 'FIXED',
      inspectorEmployeeCodeSnapshot: 'E002',
      inspectorEmployeeNameSnapshot: '検査員B',
      measuringInstrumentManagementNumberSnapshot: 'MIC-002',
      measuringInstrumentNameSnapshot: '検査用マイクロメータ',
      measuringInstrumentTagUidSnapshot: 'TAG-INSPECTOR'
    }
  });
  await prisma.selfInspectionInspectorMeasurementValue.createMany({
    data: template.items.map((item, index) => ({
      inspectorEntryId: inspectorEntry.id,
      templateItemId: item.id,
      operatorMeasurementValueId: operatorValues[index]?.id,
      operatorValueSnapshot: index === 0 ? '12' : '10',
      inspectorValue: '10',
      differenceValue: index === 0 ? '-2' : '0',
      finalJudgementStatus: index === 0 ? 'FINAL_OK' : null,
      judgedAt: index === 0 ? new Date('2026-07-28T00:01:00Z') : null
    }))
  });
}

function stableMeasurementSnapshot(
  values: Array<Record<string, unknown>>
): string {
  return JSON.stringify(
    values.map(({ updatedAt: _updatedAt, createdAt: _createdAt, ...value }) => value)
  );
}

function stableProtectedSessionSnapshot(sessions: unknown): string {
  return JSON.stringify(sessions, (key, value) => {
    if (
      key === 'updatedAt' ||
      key === 'expectedEntryCount' ||
      key === 'entrySlotKind'
    ) {
      return undefined;
    }
    return value;
  });
}

describe('SelfInspectionSamplingPolicyCorrectionService', () => {
  beforeEach(async () => {
    await cleanupFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await cleanupFixture();
    await prisma.$disconnect();
  });

  it('keeps dry-run read-only and applies a standard v6 plus an idempotent v5 session correction', async () => {
    const service = new SelfInspectionSamplingPolicyCorrectionService();
    const beforeOperatorValues = await prisma.selfInspectionMeasurementValue.findMany({
      where: { entry: { sessionId: POPULATED_SESSION_ID } },
      orderBy: { id: 'asc' }
    });
    const beforeInspectorValues =
      await prisma.selfInspectionInspectorMeasurementValue.findMany({
        where: { inspectorEntry: { sessionId: POPULATED_SESSION_ID } },
        orderBy: { id: 'asc' }
      });
    const beforeSessions = await prisma.selfInspectionSession.findMany({
      where: { id: { in: [POPULATED_SESSION_ID, EMPTY_SESSION_ID] } },
      orderBy: { id: 'asc' },
      include: { entries: true, inspectorEntries: true }
    });

    const dryRun = await service.run(target, { execute: false });
    expect(dryRun).toMatchObject({
      phase: 'pending',
      dryRun: true,
      changed: false,
      replacementTemplate: null
    });
    expect(
      await prisma.partMeasurementTemplate.count({
        where: { fhincd: FHINCD, resourceCd: RESOURCE_CD }
      })
    ).toBe(1);

    const result = await service.run(target, { execute: true });
    expect(result).toMatchObject({
      phase: 'applied',
      dryRun: false,
      changed: true,
      sourceTemplate: {
        version: 5,
        isActive: false,
        selfInspectionMode: 'SINGLE',
        itemCount: 13
      },
      replacementTemplate: {
        version: 6,
        selfInspectionMode: 'SINGLE',
        itemCount: 13
      }
    });
    const sessions = await prisma.selfInspectionSession.findMany({
      where: { id: { in: [POPULATED_SESSION_ID, EMPTY_SESSION_ID] } },
      orderBy: { id: 'asc' },
      include: { entries: true, inspectorEntries: true }
    });
    expect(sessions.map((session) => session.expectedEntryCount)).toEqual([1, 1]);
    expect(sessions.flatMap((session) => session.entries).map((entry) => entry.entrySlotKind)).toEqual([
      'SINGLE'
    ]);
    expect(
      sessions
        .flatMap((session) => session.inspectorEntries)
        .map((entry) => entry.entrySlotKind)
    ).toEqual(['SINGLE']);

    const afterOperatorValues = await prisma.selfInspectionMeasurementValue.findMany({
      where: { entry: { sessionId: POPULATED_SESSION_ID } },
      orderBy: { id: 'asc' }
    });
    const afterInspectorValues =
      await prisma.selfInspectionInspectorMeasurementValue.findMany({
        where: { inspectorEntry: { sessionId: POPULATED_SESSION_ID } },
        orderBy: { id: 'asc' }
      });
    expect(
      stableMeasurementSnapshot(
        afterOperatorValues as unknown as Array<Record<string, unknown>>
      )
    ).toBe(
      stableMeasurementSnapshot(
        beforeOperatorValues as unknown as Array<Record<string, unknown>>
      )
    );
    expect(
      stableMeasurementSnapshot(
        afterInspectorValues as unknown as Array<Record<string, unknown>>
      )
    ).toBe(
      stableMeasurementSnapshot(
        beforeInspectorValues as unknown as Array<Record<string, unknown>>
      )
    );
    expect(stableProtectedSessionSnapshot(sessions)).toBe(
      stableProtectedSessionSnapshot(beforeSessions)
    );

    await expect(service.run(target, { execute: true })).resolves.toMatchObject({
      phase: 'applied',
      dryRun: false,
      changed: false
    });
  });

  it('aborts without creating v6 when a session is already completed', async () => {
    await prisma.selfInspectionSession.update({
      where: { id: EMPTY_SESSION_ID },
      data: { completedAt: new Date() }
    });
    const service = new SelfInspectionSamplingPolicyCorrectionService();

    await expect(service.run(target, { execute: true })).rejects.toThrow(
      SelfInspectionSamplingPolicyCorrectionError
    );
    expect(
      await prisma.partMeasurementTemplate.count({
        where: { fhincd: FHINCD, resourceCd: RESOURCE_CD }
      })
    ).toBe(1);
  });

  it('aborts for an entry above index zero or an issued paper report', async () => {
    await prisma.selfInspectionLotEntry.create({
      data: {
        sessionId: EMPTY_SESSION_ID,
        entryIndex: 1,
        entrySlotKind: 'FIXED'
      }
    });
    const service = new SelfInspectionSamplingPolicyCorrectionService();
    await expect(service.run(target, { execute: false })).rejects.toThrow(
      /entryIndex 1以上/
    );

    await prisma.selfInspectionLotEntry.deleteMany({
      where: { sessionId: EMPTY_SESSION_ID }
    });
    await prisma.selfInspectionPaperReport.create({
      data: {
        sessionId: EMPTY_SESSION_ID,
        scheduleRowId: 'row-empty',
        templateId: SOURCE_TEMPLATE_ID,
        plannedQuantity: 5,
        templateVersion: 5
      }
    });
    await expect(service.run(target, { execute: false })).rejects.toThrow(
      /紙帳票/
    );
  });

  it('aborts without mutation when the target definition differs from the actual template', async () => {
    const service = new SelfInspectionSamplingPolicyCorrectionService();
    await expect(
      service.run({ ...target, expectedTemplateItemCount: 12 }, { execute: true })
    ).rejects.toThrow(/測定点数が12件ではありません/);
    expect(
      await prisma.partMeasurementTemplate.count({
        where: { fhincd: FHINCD, resourceCd: RESOURCE_CD }
      })
    ).toBe(1);
  });
});
