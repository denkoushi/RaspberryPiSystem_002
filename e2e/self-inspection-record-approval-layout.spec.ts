import { expect, test, type Page } from '@playwright/test';

const CLIENT_KEY = 'client-key-raspberrypi4-kiosk1';
const RECORD_APPROVALS_PATH = '/api/part-measurement/self-inspection/record-approvals';
const INVALIDATIONS_PATH = '/api/part-measurement/self-inspection/invalidations';
const sessionId = 'record-approval-layout-session';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    sessionBusinessKey: 'record-approval-layout-business',
    templateId: 'record-approval-layout-template',
    templateName: 'レイアウト確認テンプレート',
    productNo: 'ORDER-LAYOUT-001',
    fseiban: 'SEIBAN-LAYOUT-001',
    fhincd: 'FH-LAYOUT-001',
    fhinmei: 'レイアウト確認品',
    processGroup: 'cutting',
    resourceCd: '581',
    scheduleRowId: 'record-approval-layout-schedule',
    machineName: '設備A',
    plannedQuantity: 1,
    expectedEntryCount: 1,
    requiredEntryCount: 1,
    completedEntryCount: 1,
    pendingReviewCount: 0,
    participantEmployeeNames: ['作業者A'],
    participantEmployees: [],
    selfInspectionMode: 'all',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    status: 'review_pending',
    startedAt: '2026-08-21T00:00:00.000Z',
    completedAt: null,
    recordApprovalRequiredAt: '2026-08-21T00:00:00.000Z',
    recordApprovalWorkflowStartedAt: '2026-08-21T00:00:00.000Z',
    decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
    inspectorRemeasurementRequiredAt: '2026-08-21T00:30:00.000Z',
    inspectorMeasurementState: 'in_progress',
    inspectorRequiredEntryCount: 1,
    inspectorCompletedRequiredEntryCount: 1,
    inspectorMissingRequiredEntryCount: 0,
    inspectorIncompleteValueEntryCount: 0,
    updatedAt: '2026-08-21T01:02:03.000Z',
    recordApprovalState: 'inspector_measurement_pending',
    recordApproval: null,
    completedRequiredEntryCount: 1,
    missingRequiredEntryCount: 0,
    incompleteValueEntryCount: 0,
    incompleteRegistrationEntryCount: 0,
    inspectorIncompleteRegistrationEntryCount: 0
  };
}

function makeRequiredEntries() {
  const baseValue = {
    id: 'value-layout-1',
    templateItemId: 'template-item-layout-1',
    displayMarker: '①',
    datumSurface: 'A',
    measurementPoint: '基準面A',
    measurementLabel: '外径',
    unit: 'mm',
    valueKind: 'numeric',
    judgementResult: null,
    lowerLimit: '24.95',
    upperLimit: '25.05',
    reviewStatus: null,
    outOfToleranceAcknowledgedAt: null,
    approvedAt: null,
    updatedAt: '2026-08-21T01:00:00.000Z',
    inspectorValueId: 'inspector-value-layout-1',
    inspectorJudgementResult: null,
    operatorValueSnapshot: '24.98',
    inspectorJudgementStatus: 'MATCH',
    inspectorJudgedAt: null,
    inspectorJudgementComment: null,
    inspectorUpdatedAt: '2026-08-21T01:01:00.000Z'
  };

  return [
    {
      entryIndex: 0,
      entrySlotKind: 'single',
      entrySlotLabel: '先頭',
      state: 'ready',
      entry: {
        id: 'entry-layout-1',
        entryIndex: 0,
        persistenceStatus: 'confirmed',
        createdByEmployeeId: 'employee-layout-1',
        createdByEmployeeNameSnapshot: '作業者A',
        inspectorEmployeeId: null,
        inspectorEmployeeCodeSnapshot: null,
        inspectorEmployeeNameSnapshot: null,
        inspectorEmployeeNfcTagUidSnapshot: null,
        measuringInstrumentId: 'instrument-layout-1',
        measuringInstrumentManagementNumberSnapshot: 'M-102',
        measuringInstrumentNameSnapshot: 'マイクロメータ',
        measuringInstrumentTagUidSnapshot: null,
        instrumentUsages: [],
        createdAt: '2026-08-21T00:50:00.000Z',
        updatedAt: '2026-08-21T01:00:00.000Z'
      },
      inspectorEntry: {
        id: 'inspector-entry-layout-1',
        entryIndex: 0,
        persistenceStatus: 'confirmed',
        inspectorEmployeeId: 'inspector-layout-1',
        inspectorEmployeeCodeSnapshot: 'I001',
        inspectorEmployeeNameSnapshot: '検査員A',
        inspectorEmployeeNfcTagUidSnapshot: null,
        measuringInstrumentId: 'instrument-layout-2',
        measuringInstrumentManagementNumberSnapshot: 'M-106',
        measuringInstrumentNameSnapshot: 'マイクロメータ',
        measuringInstrumentTagUidSnapshot: null,
        instrumentUsages: [],
        clientDeviceId: 'device-layout-1',
        clientDeviceNameSnapshot: 'E2E kiosk',
        createdAt: '2026-08-21T00:55:00.000Z',
        updatedAt: '2026-08-21T01:01:00.000Z'
      },
      values: [
        {
          ...baseValue,
          value: '24.98',
          isWithinTolerance: true,
          inspectorValue: '24.99',
          differenceValue: '+0.01'
        },
        {
          ...baseValue,
          id: 'value-layout-2',
          templateItemId: 'template-item-layout-2',
          displayMarker: '②',
          measurementPoint: '中央部',
          measurementLabel: '溝幅',
          value: '10.14',
          isWithinTolerance: false,
          inspectorValueId: 'inspector-value-layout-2',
          inspectorValue: '10.12',
          differenceValue: '-0.02',
          lowerLimit: '9.95',
          upperLimit: '10.05',
          inspectorJudgementStatus: 'MISMATCH'
        }
      ]
    }
  ];
}

const invalidation = {
  id: 'record-approval-layout-invalidation',
  itemBusinessKey: 'record-approval-layout-item',
  requestId: 'record-approval-layout-request',
  sessionId: null,
  scheduleRowId: 'record-approval-layout-schedule',
  sourceState: 'NOT_STARTED',
  templateIdSnapshot: 'record-approval-layout-template',
  productNoSnapshot: 'ORDER-DELETED-001',
  processGroupSnapshot: 'CUTTING',
  resourceCdSnapshot: '581',
  fseibanSnapshot: null,
  fhincdSnapshot: 'FH-LAYOUT-001',
  fhinmeiSnapshot: '削除済みレイアウト確認品',
  machineNameSnapshot: null,
  plannedQuantitySnapshot: 1,
  expectedEntryCountSnapshot: 1,
  reason: 'E2E レイアウト確認用',
  invalidatedByUsernameSnapshot: 'e2e',
  invalidatedByClientDeviceId: 'e2e-device',
  invalidatedByClientDeviceNameSnapshot: 'E2E kiosk',
  invalidatedAt: '2026-08-21T01:02:03.000Z',
  createdAt: '2026-08-21T01:02:03.000Z'
};

async function installApiMocks(page: Page) {
  const requestedHeaders: string[] = [];
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const clientKey = request.headers()['x-client-key'];
    if (path.startsWith('/api/part-measurement/self-inspection/')) {
      requestedHeaders.push(clientKey ?? '');
    }

    if (path === '/api/system/deploy-status') {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }
    if (path === '/api/kiosk/config') {
      await route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
      return;
    }
    if (path === '/api/kiosk/call/targets') {
      await route.fulfill({ json: { selfClientId: 'record-approval-layout-e2e', targets: [] } });
      return;
    }
    if (path === '/api/kiosk/support/targets') {
      await route.fulfill({ json: { targets: [] } });
      return;
    }
    if (path === '/api/part-measurement/self-inspection/registration-policy') {
      await route.fulfill({
        json: {
          policy: {
            key: 'shared',
            requireMeasuringInstrumentTag: false,
            updatedAt: null,
            updatedBy: null
          }
        }
      });
      return;
    }
    if (path === RECORD_APPROVALS_PATH) {
      const completed = url.searchParams.get('scope') === 'completed_records';
      await route.fulfill({
        json: {
          sessions: completed ? [{ ...makeSession(), recordApprovalState: 'completed' }] : [makeSession()],
          listLimit: 200,
          truncated: false
        }
      });
      return;
    }
    if (path === `${RECORD_APPROVALS_PATH}/sessions/${sessionId}`) {
      await route.fulfill({ json: { session: { ...makeSession(), requiredEntries: makeRequiredEntries() } } });
      return;
    }
    if (path === INVALIDATIONS_PATH) {
      await route.fulfill({ json: { invalidations: [invalidation], listLimit: 200, truncated: false } });
      return;
    }
    if (path === `${INVALIDATIONS_PATH}/${invalidation.id}`) {
      await route.fulfill({ json: { invalidation: { ...invalidation, session: null } } });
      return;
    }

    // Kiosk chrome can issue unrelated read requests while mounting. They are
    // intentionally harmless for this layout fixture.
    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });
  return requestedHeaders;
}

async function openRecordApprovalPage(page: Page) {
  const requestedHeaders = await installApiMocks(page);
  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);
  await page.goto('/kiosk/part-measurement/self-inspection/record-approvals', {
    waitUntil: 'domcontentloaded'
  });
  await expect(page.getByRole('heading', { name: '検査記録確認', exact: true })).toBeVisible();
  await expect(page.getByText('ORDER-LAYOUT-001').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '未完了' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '完了記録' })).toBeVisible();
  await expect(page.getByRole('button', { name: '削除履歴' })).toBeVisible();
  expect(requestedHeaders.filter((key) => key === CLIENT_KEY).length).toBeGreaterThan(0);
  return requestedHeaders;
}

test.describe('検査記録確認のキオスクレイアウト', () => {
  for (const viewport of [
    { width: 1280, height: 760 },
    { width: 1536, height: 864 },
    { width: 1920, height: 1080 }
  ]) {
    test(`${viewport.width}x${viewport.height}で3分類と横overflowなしを維持する`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openRecordApprovalPage(page);

      const returnLink = page.getByRole('link', { name: '自主検査画面へ戻る' });
      await expect(returnLink).toHaveAttribute('href', '/kiosk/part-measurement/self-inspection');
      await expect(
        page.getByText('作業者・検査員の入力値と、承認・最終判定の進捗を確認します。')
      ).toHaveCount(0);

      const selectedRecord = page.getByRole('region', { name: '選択中の検査記録' });
      const operatorLink = selectedRecord.getByRole('link', { name: '作業者入力へ' });
      const inspectorLink = selectedRecord.getByRole('link', { name: '検査員測定へ' });
      await expect(operatorLink).toBeVisible();
      await expect(inspectorLink).toBeVisible();
      await expect(selectedRecord.getByRole('link', { name: '検査員画面' })).toHaveCount(0);
      const actionMetrics = await selectedRecord.locator('a').evaluateAll((links) =>
        links.map((link) => {
          const rect = link.getBoundingClientRect();
          return { width: rect.width, height: rect.height, top: rect.top };
        })
      );
      expect(actionMetrics).toHaveLength(2);
      expect(actionMetrics[0]?.width).toBe(actionMetrics[1]?.width);
      expect(actionMetrics[0]?.height).toBe(actionMetrics[1]?.height);
      expect(actionMetrics[0]?.top).toBe(actionMetrics[1]?.top);

      const measurementTable = page.getByRole('table', { name: '測定値一覧' });
      await expect(measurementTable.getByText('作業点検', { exact: true })).toBeVisible();
      await expect(measurementTable.getByText('検査点検', { exact: true })).toBeVisible();
      const measurementMetrics = await measurementTable.evaluate((table) => {
        const scroller = table.parentElement;
        const operatorValue = table.querySelector('tbody tr td:nth-last-child(5) span');
        const firstRow = table.querySelector('tbody tr');
        return {
          clientWidth: scroller?.clientWidth ?? 0,
          scrollWidth: scroller?.scrollWidth ?? 0,
          operatorFontSize: operatorValue ? Number.parseFloat(getComputedStyle(operatorValue).fontSize) : 0,
          firstRowHeight: firstRow?.getBoundingClientRect().height ?? 0
        };
      });
      expect(measurementMetrics.scrollWidth).toBeLessThanOrEqual(measurementMetrics.clientWidth + 1);
      expect(measurementMetrics.operatorFontSize).toBeGreaterThanOrEqual(24);
      expect(measurementMetrics.firstRowHeight).toBeLessThanOrEqual(64);

      const shellMetrics = await page.locator('body').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }));
      expect(shellMetrics.scrollWidth).toBeLessThanOrEqual(shellMetrics.clientWidth + 1);

      await page.getByRole('button', { name: '完了記録' }).click();
      await expect(page.getByRole('button', { name: '完了記録' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('ORDER-LAYOUT-001').first()).toBeVisible();

      await page.getByRole('button', { name: '削除履歴' }).click();
      await expect(page.getByRole('button', { name: '削除履歴' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('削除済み・閲覧専用')).toBeVisible();

      const screenshotDir = process.env.SELF_INSPECTION_E2E_SCREENSHOT_DIR?.replace(/\/$/, '');
      if (screenshotDir) {
        await page.screenshot({
          path: `${screenshotDir}/self-inspection-record-approval-${viewport.width}x${viewport.height}.png`,
          fullPage: true
        });
      }
    });
  }

  test('自主検査画面へ戻るボタンは正規routeへ遷移する', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await openRecordApprovalPage(page);

    await page.getByRole('link', { name: '自主検査画面へ戻る' }).click();
    await expect(page).toHaveURL(/\/kiosk\/part-measurement\/self-inspection$/);
  });

  test('設定ダイアログがフォーカスを管理してEscapeで起点へ戻す', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await openRecordApprovalPage(page);

    const opener = page.getByRole('button', { name: '計測機器の使用前点検必須 OFF' });
    await opener.click();

    const dialog = page.getByRole('dialog');
    const password = page.getByLabel('操作時パスワード');
    await expect(dialog).toBeVisible();
    await expect(password).toBeFocused();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    await password.press('Shift+Tab');
    await expect(page.getByRole('button', { name: '変更する' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });
});
