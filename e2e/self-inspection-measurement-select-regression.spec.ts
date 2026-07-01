import { test, expect } from '@playwright/test';

const SESSION_ID = 'e2e-self-inspection-tolerance-display';
const DRAWING_PATH = '/api/storage/part-measurement-drawings/e2e-tolerance-display.svg';

const drawingSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#f8fafc"/>
  <rect x="48" y="48" width="544" height="264" fill="none" stroke="#334155" stroke-width="3"/>
  <line x1="80" y1="180" x2="560" y2="180" stroke="#64748b" stroke-width="2"/>
  <circle cx="320" cy="180" r="36" fill="none" stroke="#0f172a" stroke-width="4"/>
</svg>
`.trim();

function nowIso() {
  return '2026-07-01T00:00:00.000Z';
}

function makeEntry() {
  return {
    id: 'entry-e2e-1',
    entryIndex: 0,
    entrySlotKind: 'single',
    entrySlotLabel: '1件',
    createdByEmployeeId: 'employee-e2e',
    createdByEmployeeNameSnapshot: 'E2E Tester',
    measuringInstrumentId: null,
    measuringInstrumentManagementNumberSnapshot: null,
    measuringInstrumentNameSnapshot: null,
    measuringInstrumentTagUidSnapshot: null,
    instrumentUsages: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    values: [
      {
        id: 'value-e2e-1',
        templateItemId: 'item-e2e-1',
        value: null,
        reviewStatus: 'NOT_REQUIRED',
        outOfToleranceAcknowledgedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        approvedByUsername: null,
        approvalComment: null
      }
    ]
  };
}

function makeSession() {
  const entry = makeEntry();
  return {
    id: SESSION_ID,
    sessionBusinessKey: 'e2e-session-business-key',
    templateId: 'template-e2e',
    templateName: 'E2E tolerance template',
    productNo: 'PRODUCT-E2E',
    fseiban: 'FSEIBAN-E2E',
    fhincd: 'FHINCD-E2E',
    fhinmei: 'E2E self inspection product',
    processGroup: 'cutting',
    resourceCd: 'R-E2E',
    scheduleRowId: 'schedule-row-e2e',
    machineName: 'E2E machine',
    plannedQuantity: 1,
    expectedEntryCount: 1,
    requiredEntryCount: 1,
    entryCountBlockedReason: null,
    completedEntryCount: 0,
    pendingReviewCount: 0,
    participantEmployeeNames: ['E2E Tester'],
    selfInspectionMode: 'single',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    status: 'in_progress',
    startedAt: nowIso(),
    completedAt: null,
    recordApprovalRequiredAt: null,
    recordApprovalWorkflowStartedAt: null,
    recordApproval: null,
    updatedAt: nowIso(),
    template: {
      id: 'template-e2e',
      fhincd: 'FHINCD-E2E',
      resourceCd: 'R-E2E',
      processGroup: 'cutting',
      templateScope: 'three_key',
      candidateFhinmei: null,
      name: 'E2E tolerance template',
      version: 1,
      isActive: true,
      selfInspectionMode: 'single',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'visual-template-e2e',
      visualTemplate: {
        id: 'visual-template-e2e',
        name: 'E2E drawing',
        drawingImageRelativePath: DRAWING_PATH,
        isActive: true,
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      items: [
        {
          id: 'item-e2e-1',
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P1',
          measurementLabel: '幾何公差',
          displayMarker: '1',
          unit: 'mm',
          allowNegative: true,
          decimalPlaces: 1,
          markerXRatio: '0.5',
          markerYRatio: '0.5',
          nominalValue: '10',
          lowerLimit: '9.9',
          upperLimit: '10.1'
        }
      ]
    },
    entries: [entry],
    focusedEntry: entry
  };
}

async function installApiMocks(page: import('@playwright/test').Page) {
  const unexpectedApiRequests: string[] = [];

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/system/deploy-status') {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }

    if (path === '/api/kiosk/config') {
      await route.fulfill({
        json: {
          defaultMode: 'tag',
          clientStatus: null
        }
      });
      return;
    }

    if (path === '/api/kiosk/call/targets') {
      await route.fulfill({ json: { selfClientId: 'e2e-client', targets: [] } });
      return;
    }

    if (path === '/api/kiosk/employees') {
      await route.fulfill({ json: { employees: [] } });
      return;
    }

    if (path === '/api/part-measurement/self-inspection/registration-policy') {
      await route.fulfill({
        json: {
          policy: {
            key: 'self_inspection_registration',
            requireMeasuringInstrumentTag: false,
            updatedAt: null,
            updatedBy: null
          }
        }
      });
      return;
    }

    if (path === `/api/part-measurement/self-inspection/sessions/${SESSION_ID}`) {
      await route.fulfill({ json: { session: makeSession() } });
      return;
    }

    if (path === DRAWING_PATH) {
      await route.fulfill({
        body: drawingSvg,
        contentType: 'image/svg+xml'
      });
      return;
    }

    unexpectedApiRequests.push(`${route.request().method()} ${path}`);
    await route.fulfill({
      status: 404,
      json: { message: `Unexpected E2E API request: ${path}` }
    });
  });

  return unexpectedApiRequests;
}

test.describe('自主検査セッション 測定値選択 regressions', () => {
  test('renders signed tolerance range and measurement select without hint text', async ({ page }) => {
    const unexpectedApiRequests = await installApiMocks(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'kiosk-client-key',
        JSON.stringify('client-key-raspberrypi4-kiosk1')
      );
    });

    await page.goto(`/kiosk/part-measurement/self-inspection/sessions/${SESSION_ID}`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.getByText('読込中…')).toHaveCount(0);
    await expect(page.getByText('図面を読み込み中…')).toHaveCount(0);

    await expect(page.getByText('基準 10 / -0.1〜+0.1')).toBeVisible();
    await expect(page.getByText('測定値選択')).toBeVisible();

    const measurementSelect = page.getByLabel('測定値選択');
    await expect(measurementSelect).toBeVisible();
    await expect(measurementSelect.locator('option').first()).toHaveText('');
    await expect(page.getByText(/候補から選択|0\.1候補|候補（刻み/)).toHaveCount(0);

    expect(unexpectedApiRequests).toEqual([]);
  });
});
