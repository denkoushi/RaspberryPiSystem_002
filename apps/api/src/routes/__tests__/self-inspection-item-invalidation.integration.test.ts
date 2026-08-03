import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';
import { configureTestDueManagementAccessPassword } from '../../test/due-management-access-password.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const fixtures: Fixture[] = [];
const userIds: string[] = [];

async function createFixture(options?: {
  withSession?: boolean;
  withEntry?: boolean;
  withPaperReports?: boolean;
}) {
  const suffix = randomUUID();
  const productNo = `SI-INVALIDATE-${suffix}`;
  const fseiban = `FS-${suffix}`;
  const fhincd = `FH-${suffix}`;
  const fhinmei = `削除検証品 ${suffix}`;
  const resourceCd = `R-${suffix}`;
  const visualTemplate = await prisma.partMeasurementVisualTemplate.create({
    data: {
      name: `SIINVALIDATION${suffix.replaceAll('-', '')}`,
      searchDigits: suffix.replaceAll('-', '').replaceAll(/\D/g, ''),
      drawingImageRelativePath: `/api/test/${suffix}.png`
    }
  });
  const template = await prisma.partMeasurementTemplate.create({
    data: {
      fhincd,
      processGroup: 'CUTTING',
      resourceCd,
      name: `自主検査削除 ${suffix}`,
      visualTemplateId: visualTemplate.id,
      selfInspectionMode: 'FIXED_COUNT',
      selfInspectionFixedCount: 1,
      items: {
        create: {
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P1',
          measurementLabel: '寸法1',
          displayMarker: '1',
          markerXRatio: '0.2',
          markerYRatio: '0.3',
          lowerLimit: '9.8',
          upperLimit: '10.2',
          nominalValue: '10',
          allowNegative: false,
          decimalPlaces: 2
        }
      }
    },
    include: { items: true }
  });
  await prisma.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    update: {},
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'ProductionSchedule_Test',
      columnDefinitions: [],
      templateType: 'CARD_GRID',
      templateConfig: {},
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['ProductNo'],
      dateColumnName: 'registeredAt',
      enabled: true
    }
  });
  const scheduleRow = await prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(),
      dataHash: `self-inspection-invalidation-${suffix}`,
      rowData: {
        ProductNo: productNo,
        FSEIBAN: fseiban,
        FHINCD: fhincd,
        FHINMEI: fhinmei,
        FSIGENCD: resourceCd
      }
    }
  });
  await prisma.productionScheduleOrderSupplement.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: scheduleRow.id,
      sourceCsvDashboardId: '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31',
      productNo: productNo.slice(0, 20),
      resourceCd: resourceCd.slice(0, 20),
      processOrder: '10',
      plannedQuantity: 1
    }
  });

  let session: Awaited<ReturnType<typeof prisma.selfInspectionSession.create>> | null = null;
  let activePaperReportId: string | null = null;
  let importedPaperReportId: string | null = null;
  if (options?.withSession) {
    session = await prisma.selfInspectionSession.create({
      data: {
        sessionBusinessKey: `${productNo}::CUTTING::${resourceCd}::${scheduleRow.id}`,
        templateId: template.id,
        productNo,
        processGroup: 'CUTTING',
        resourceCd,
        scheduleRowId: scheduleRow.id,
        fseiban,
        fhincd,
        fhinmei,
        plannedQuantity: 1,
        expectedEntryCount: 1,
        startedAt: new Date(),
        decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
        ...(options.withEntry === false
          ? {}
          : {
              entries: {
                create: {
                  entryIndex: 0,
                  entrySlotKind: 'FIXED',
                  persistenceStatus: 'CONFIRMED',
                  createdByEmployeeNameSnapshot: '削除検証作業者',
                  values: {
                    create: {
                      templateItemId: template.items[0].id,
                      value: '10.0',
                      reviewStatus: 'NOT_REQUIRED'
                    }
                  }
                }
              }
            })
      }
    });
    if (options.withPaperReports) {
      const active = await prisma.selfInspectionPaperReport.create({
        data: {
          sessionId: session.id,
          scheduleRowId: scheduleRow.id,
          templateId: template.id,
          status: 'OCR_REVIEW',
          plannedQuantity: 1,
          templateVersion: template.version
        }
      });
      const imported = await prisma.selfInspectionPaperReport.create({
        data: {
          sessionId: session.id,
          scheduleRowId: scheduleRow.id,
          templateId: template.id,
          status: 'IMPORTED',
          importedAt: new Date(),
          plannedQuantity: 1,
          templateVersion: template.version
        }
      });
      activePaperReportId = active.id;
      importedPaperReportId = imported.id;
    }
  }

  return {
    productNo,
    fseiban,
    fhincd,
    fhinmei,
    resourceCd,
    visualTemplate,
    template,
    scheduleRow,
    session,
    activePaperReportId,
    importedPaperReportId
  };
}

function scheduleTarget(fixture: Fixture) {
  return {
    kind: 'schedule_row' as const,
    scheduleRowId: fixture.scheduleRow.id,
    templateId: fixture.template.id,
    productNo: fixture.productNo,
    processGroup: 'cutting' as const,
    resourceCd: fixture.resourceCd,
    fseiban: fixture.fseiban,
    fhincd: fixture.fhincd,
    fhinmei: fixture.fhinmei
  };
}

describe('self-inspection item invalidation API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
    await configureTestDueManagementAccessPassword();
  });

  afterAll(async () => {
    for (const fixture of fixtures.reverse()) {
      await prisma.selfInspectionItemInvalidation.deleteMany({
        where: { scheduleRowId: fixture.scheduleRow.id }
      });
      await prisma.selfInspectionSession.deleteMany({
        where: { scheduleRowId: fixture.scheduleRow.id }
      });
      await prisma.productionScheduleOrderSupplement.deleteMany({
        where: { csvDashboardRowId: fixture.scheduleRow.id }
      });
      await prisma.csvDashboardRow.deleteMany({ where: { id: fixture.scheduleRow.id } });
      await prisma.partMeasurementTemplate.deleteMany({ where: { id: fixture.template.id } });
      await prisma.partMeasurementVisualTemplate.deleteMany({
        where: { id: fixture.visualTemplate.id }
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('invalidates a started item idempotently, cancels only active paper reports, and retains history', async () => {
    const fixture = await createFixture({ withSession: true, withPaperReports: true });
    fixtures.push(fixture);
    const admin = await createTestUser('ADMIN');
    userIds.push(admin.user.id);
    const headers = createAuthHeader(admin.token);
    const requestId = randomUUID();
    const payload = {
      target: { kind: 'session', sessionId: fixture.session!.id },
      accessPassword: '2520',
      reason: '入力対象の選択誤り',
      requestId
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().invalidation).toMatchObject({
      sessionId: fixture.session!.id,
      scheduleRowId: fixture.scheduleRow.id,
      sourceState: 'IN_PROGRESS',
      reason: payload.reason,
      productNoSnapshot: fixture.productNo
    });
    const invalidationId = response.json().invalidation.id as string;

    const replay = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().invalidation.id).toBe(invalidationId);

    const reusedRequest = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload: { ...payload, reason: '別の理由' }
    });
    expect(reusedRequest.statusCode).toBe(409);
    expect(reusedRequest.json().errorCode).toBe(
      'SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT'
    );

    const [session, activePaper, importedPaper, valueCount] = await Promise.all([
      prisma.selfInspectionSession.findUniqueOrThrow({ where: { id: fixture.session!.id } }),
      prisma.selfInspectionPaperReport.findUniqueOrThrow({
        where: { id: fixture.activePaperReportId! }
      }),
      prisma.selfInspectionPaperReport.findUniqueOrThrow({
        where: { id: fixture.importedPaperReportId! }
      }),
      prisma.selfInspectionMeasurementValue.count({
        where: { entry: { sessionId: fixture.session!.id } }
      })
    ]);
    expect(session.invalidatedAt).not.toBeNull();
    expect(activePaper.status).toBe('CANCELLED');
    expect(activePaper.cancelledAt).not.toBeNull();
    expect(importedPaper.status).toBe('IMPORTED');
    expect(valueCount).toBe(1);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/invalidations/${invalidationId}`,
      headers
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().invalidation.session.entries).toHaveLength(1);
    expect(detail.json().invalidation.session.paperReports).toHaveLength(2);

    const historyList = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/invalidations?productNo=${encodeURIComponent(fixture.productNo)}&resourceCd=${encodeURIComponent(fixture.resourceCd)}`,
      headers
    });
    expect(historyList.statusCode).toBe(200);
    expect(historyList.json()).toMatchObject({
      listLimit: 200,
      truncated: false
    });
    expect(historyList.json().invalidations).toHaveLength(1);
    expect(historyList.json().invalidations[0].id).toBe(invalidationId);

    const print = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/paper-reports/${fixture.activePaperReportId}/print`,
      headers
    });
    expect(print.statusCode).toBe(409);
    expect(print.json().errorCode).toBe(
      'SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT'
    );

    const normalDetail = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}`,
      headers
    });
    expect(normalDetail.statusCode).toBe(409);
    expect(normalDetail.json().errorCode).toBe(
      'SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT'
    );

    const normalList = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions?productNo=${encodeURIComponent(fixture.productNo)}`,
      headers
    });
    expect(normalList.statusCode).toBe(200);
    expect(normalList.json().sessions).toEqual([]);

    const duplicateDeletion = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload: { ...payload, requestId: randomUUID() }
    });
    expect(duplicateDeletion.statusCode).toBe(409);
    expect(duplicateDeletion.json().errorCode).toBe(
      'SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT'
    );
  });

  it('invalidates an unstarted schedule row and permanently blocks digital start', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const admin = await createTestUser('ADMIN');
    userIds.push(admin.user.id);
    const headers = createAuthHeader(admin.token);
    const payload = {
      target: scheduleTarget(fixture),
      accessPassword: '2520',
      reason: '日程対象外',
      requestId: randomUUID()
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().invalidation).toMatchObject({
      sessionId: null,
      sourceState: 'NOT_STARTED'
    });

    const restart = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
      headers,
      payload: {
        templateId: fixture.template.id,
        productNo: fixture.productNo,
        processGroup: 'cutting',
        resourceCd: fixture.resourceCd,
        scheduleRowId: fixture.scheduleRow.id,
        fseiban: fixture.fseiban,
        fhincd: fixture.fhincd,
        fhinmei: fixture.fhinmei
      }
    });
    expect(restart.statusCode).toBe(409);
    expect(restart.json().errorCode).toBe(
      'SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT'
    );

    const detail = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/invalidations/${response.json().invalidation.id}`,
      headers
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().invalidation.session).toBeNull();
  });

  it('records all five pre-invalidation lifecycle states', async () => {
    const admin = await createTestUser('ADMIN');
    userIds.push(admin.user.id);
    const headers = createAuthHeader(admin.token);
    const cases = [
      { expected: 'NOT_STARTED' as const, withEntry: false },
      { expected: 'IN_PROGRESS' as const, withEntry: true },
      { expected: 'REVIEW_PENDING' as const, withEntry: true },
      { expected: 'COMPLETED' as const, withEntry: true },
      { expected: 'APPROVED' as const, withEntry: true }
    ];

    for (const testCase of cases) {
      const fixture = await createFixture({
        withSession: true,
        withEntry: testCase.withEntry
      });
      fixtures.push(fixture);
      if (testCase.expected === 'REVIEW_PENDING') {
        await prisma.selfInspectionSession.update({
          where: { id: fixture.session!.id },
          data: { recordApprovalRequiredAt: new Date() }
        });
      } else if (testCase.expected === 'COMPLETED') {
        await prisma.selfInspectionSession.update({
          where: { id: fixture.session!.id },
          data: { completedAt: new Date() }
        });
      } else if (testCase.expected === 'APPROVED') {
        await prisma.selfInspectionRecordApproval.create({
          data: {
            sessionId: fixture.session!.id,
            approverEmployeeCodeSnapshot: '9999',
            approverEmployeeNameSnapshot: '承認者',
            approverEmployeeNfcTagUidSnapshot: `APPROVER-${randomUUID()}`
          }
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/part-measurement/self-inspection/items/invalidate',
        headers,
        payload: {
          target: { kind: 'session', sessionId: fixture.session!.id },
          accessPassword: '2520',
          reason: `${testCase.expected}の削除検証`,
          requestId: randomUUID()
        }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().invalidation.sourceState).toBe(testCase.expected);
    }
  });

  it('serializes deletion against digital start and paper report issue without 500s or orphan state', async () => {
    const admin = await createTestUser('ADMIN');
    userIds.push(admin.user.id);
    const headers = createAuthHeader(admin.token);

    const digitalFixture = await createFixture();
    fixtures.push(digitalFixture);
    const [digitalDeletion, digitalStart] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/self-inspection/items/invalidate',
        headers,
        payload: {
          target: scheduleTarget(digitalFixture),
          accessPassword: '2520',
          reason: 'デジタル開始との競合検証',
          requestId: randomUUID()
        }
      }),
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
        headers,
        payload: {
          templateId: digitalFixture.template.id,
          productNo: digitalFixture.productNo,
          processGroup: 'cutting',
          resourceCd: digitalFixture.resourceCd,
          scheduleRowId: digitalFixture.scheduleRow.id,
          fseiban: digitalFixture.fseiban,
          fhincd: digitalFixture.fhincd,
          fhinmei: digitalFixture.fhinmei
        }
      })
    ]);
    expect(digitalDeletion.statusCode).toBe(200);
    expect([200, 409]).toContain(digitalStart.statusCode);
    expect(digitalStart.statusCode).not.toBe(500);
    const digitalSessions = await prisma.selfInspectionSession.findMany({
      where: { scheduleRowId: digitalFixture.scheduleRow.id }
    });
    expect(digitalSessions.length).toBeLessThanOrEqual(1);
    expect(digitalSessions.every((session) => session.invalidatedAt != null)).toBe(true);

    const paperFixture = await createFixture();
    fixtures.push(paperFixture);
    const [paperDeletion, paperIssue] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/self-inspection/items/invalidate',
        headers,
        payload: {
          target: scheduleTarget(paperFixture),
          accessPassword: '2520',
          reason: '紙帳票発行との競合検証',
          requestId: randomUUID()
        }
      }),
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/self-inspection/paper-reports/issue',
        headers,
        payload: {
          templateId: paperFixture.template.id,
          productNo: paperFixture.productNo,
          scheduleRowId: paperFixture.scheduleRow.id,
          fseiban: paperFixture.fseiban,
          fhincd: paperFixture.fhincd,
          fhinmei: paperFixture.fhinmei,
          resourceCd: paperFixture.resourceCd
        }
      })
    ]);
    expect(paperDeletion.statusCode).toBe(200);
    expect([200, 409]).toContain(paperIssue.statusCode);
    expect(paperIssue.statusCode).not.toBe(500);
    const reports = await prisma.selfInspectionPaperReport.findMany({
      where: { scheduleRowId: paperFixture.scheduleRow.id }
    });
    expect(reports.every((report) => report.status === 'CANCELLED')).toBe(true);
    expect(
      await prisma.selfInspectionItemInvalidation.count({
        where: { scheduleRowId: paperFixture.scheduleRow.id }
      })
    ).toBe(1);
  });

  it('rejects every session mutation family after invalidation with the shared conflict code', async () => {
    const fixture = await createFixture({ withSession: true });
    fixtures.push(fixture);
    await prisma.selfInspectionSession.update({
      where: { id: fixture.session!.id },
      data: {
        recordApprovalRequiredAt: new Date(),
        inspectorRemeasurementRequiredAt: new Date()
      }
    });
    const admin = await createTestUser('ADMIN');
    userIds.push(admin.user.id);
    const headers = createAuthHeader(admin.token);
    const deletion = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload: {
        target: { kind: 'session', sessionId: fixture.session!.id },
        accessPassword: '2520',
        reason: '削除後変更経路の閉鎖検証',
        requestId: randomUUID()
      }
    });
    expect(deletion.statusCode).toBe(200);

    const authenticationId = randomUUID();
    const valuePayload = [
      {
        templateItemId: fixture.template.items[0].id,
        value: '10.0'
      }
    ];
    const mutationRequests = [
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/measurement-actor-authentications`,
        payload: { employeeTagUid: 'DELETED-ACTOR', measurementMode: 'operator' }
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/entries`,
        payload: {
          entryIndex: 0,
          measurementActorAuthenticationId: authenticationId,
          values: valuePayload
        }
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/entries/draft`,
        payload: {
          entryIndex: 0,
          measurementActorAuthenticationId: authenticationId,
          values: valuePayload
        }
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/inspector-entries`,
        payload: {
          entryIndex: 0,
          measurementActorAuthenticationId: authenticationId,
          values: valuePayload
        }
      },
      {
        method: 'PATCH' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/inspector-entries/${randomUUID()}/judgements`,
        payload: {
          judgements: [
            {
              templateItemId: fixture.template.items[0].id,
              judgementStatus: 'FINAL_OK'
            }
          ]
        }
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/entries/0/instrument-usages/pre-use-inspection`,
        payload: {
          instrumentTagUid: 'DELETED-INSTRUMENT',
          measurementActorAuthenticationId: authenticationId
        }
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/complete`,
        payload: {}
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/out-of-tolerance-review/approve`,
        payload: {}
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/record-approval/approve`,
        payload: { approverEmployeeTagUid: 'DELETED-APPROVER' }
      },
      {
        method: 'POST' as const,
        url: `/api/part-measurement/self-inspection/sessions/${fixture.session!.id}/reset`,
        payload: {
          confirmDestructiveReset: true,
          confirmCompletedSessionReset: false,
          requestId: randomUUID(),
          reason: '削除後リセット拒否'
        }
      },
      {
        method: 'POST' as const,
        url: '/api/part-measurement/self-inspection/paper-reports/issue',
        payload: {
          templateId: fixture.template.id,
          productNo: fixture.productNo,
          scheduleRowId: fixture.scheduleRow.id,
          fseiban: fixture.fseiban,
          fhincd: fixture.fhincd,
          fhinmei: fixture.fhinmei,
          resourceCd: fixture.resourceCd
        }
      }
    ];

    for (const request of mutationRequests) {
      const response = await app.inject({ ...request, headers });
      expect(
        response.statusCode,
        `${request.method} ${request.url}: ${response.body}`
      ).toBe(409);
      expect(response.json().errorCode).toBe(
        'SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT'
      );
    }
  });

  it('rejects bad access, blank/oversized reasons, and mismatched schedule identity', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const admin = await createTestUser('ADMIN');
    userIds.push(admin.user.id);
    const headers = createAuthHeader(admin.token);
    const base = {
      target: scheduleTarget(fixture),
      accessPassword: '2520',
      reason: '検証',
      requestId: randomUUID()
    };

    const badPassword = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload: { ...base, accessPassword: 'wrong' }
    });
    expect(badPassword.statusCode).toBe(403);

    for (const reason of ['', 'x'.repeat(501)]) {
      const invalidReason = await app.inject({
        method: 'POST',
        url: '/api/part-measurement/self-inspection/items/invalidate',
        headers,
        payload: { ...base, requestId: randomUUID(), reason }
      });
      expect(invalidReason.statusCode).toBe(400);
    }

    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload: {
        ...base,
        requestId: randomUUID(),
        target: { ...base.target, productNo: `${fixture.productNo}-WRONG` }
      }
    });
    expect(mismatch.statusCode).toBe(400);
    expect(
      await prisma.selfInspectionItemInvalidation.count({
        where: { scheduleRowId: fixture.scheduleRow.id }
      })
    ).toBe(0);

    const missingSession = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/items/invalidate',
      headers,
      payload: {
        ...base,
        requestId: randomUUID(),
        target: { kind: 'session', sessionId: randomUUID() }
      }
    });
    expect(missingSession.statusCode).toBe(404);
  });
});
