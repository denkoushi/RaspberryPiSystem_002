import { expect, test } from '@playwright/test';

const CLIENT_KEY = 'client-key-self-inspection-slot-gate';
const SESSION_ID = 'e2e-self-inspection-slot-gate';
const NOW = '2026-08-09T00:00:00.000Z';

const template = {
  id: 'slot-gate-template',
  fhincd: 'SLOT-GATE',
  resourceCd: '589',
  processGroup: 'cutting',
  templateScope: 'three_key',
  candidateFhinmei: null,
  name: '個体状態 E2E',
  version: 1,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: null,
  visualTemplate: null,
  siblingGroupId: null,
  siblingGroup: null,
  items: [
    {
      id: 'slot-gate-item',
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: 'P1',
      measurementLabel: '寸法1',
      displayMarker: '1',
      valueKind: 'numeric',
      unit: 'mm',
      allowNegative: false,
      decimalPlaces: 2,
      markerXRatio: null,
      markerYRatio: null,
      nominalValue: '10',
      lowerLimit: '9.8',
      upperLimit: '10.2'
    }
  ]
};

function makeSession() {
  return {
    id: SESSION_ID,
    sessionBusinessKey: 'slot-gate-business',
    templateId: template.id,
    templateName: template.name,
    productNo: '0003806492',
    fseiban: 'E2E-589',
    fhincd: template.fhincd,
    fhinmei: 'サドル',
    processGroup: 'cutting',
    resourceCd: '589',
    scheduleRowId: null,
    machineName: null,
    plannedQuantity: 5,
    expectedEntryCount: 5,
    requiredEntryCount: 5,
    completedEntryCount: 1,
    pendingReviewCount: 0,
    participantEmployeeNames: ['作業者'],
    participantEmployees: [],
    selfInspectionMode: 'full',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    status: 'in_progress',
    startedAt: NOW,
    completedAt: null,
    recordApprovalRequiredAt: NOW,
    recordApprovalWorkflowStartedAt: NOW,
    decisionWorkflow: 'LEGACY_RECORD_APPROVAL',
    inspectorRemeasurementRequiredAt: NOW,
    inspectorMeasurementState: 'in_progress',
    inspectorRequiredEntryCount: 5,
    inspectorCompletedRequiredEntryCount: 0,
    inspectorMissingRequiredEntryCount: 5,
    inspectorIncompleteValueEntryCount: 0,
    updatedAt: NOW,
    recordApproval: null,
    template,
    entries: [],
    operatorEntries: [],
    focusedEntry: null,
    inspectorSlotStates: [
      { entryIndex: 0, operatorState: 'confirmed', inspectorState: 'not_started' },
      { entryIndex: 1, operatorState: 'draft', inspectorState: 'not_started' },
      { entryIndex: 2, operatorState: 'missing', inspectorState: 'not_started' },
      { entryIndex: 3, operatorState: 'missing', inspectorState: 'not_started' },
      { entryIndex: 4, operatorState: 'missing', inspectorState: 'not_started' }
    ]
  };
}

test('検査員画面は個体状態を表示し、未確定個体を操作不可にする', async ({ page }) => {
  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) {
      await route.continue();
      return;
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
      await route.fulfill({ json: { selfClientId: 'slot-gate-client', targets: [] } });
      return;
    }
    if (path === '/api/kiosk/employees') {
      await route.fulfill({ json: { employees: [] } });
      return;
    }
    if (path === '/api/part-measurement/self-inspection/registration-policy') {
      await route.fulfill({ json: { policy: { requireMeasuringInstrumentTag: false } } });
      return;
    }
    if (path === `/api/part-measurement/self-inspection/sessions/${SESSION_ID}/inspector-measurements`) {
      await route.fulfill({ json: { session: makeSession() } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });

  await page.goto(`/kiosk/part-measurement/self-inspection/sessions/${SESSION_ID}/inspector`, {
    waitUntil: 'domcontentloaded'
  });
  await expect(page.getByText('未：作業者未確定')).toBeVisible();
  await expect(page.getByText('可：測定可能')).toBeVisible();
  await expect(page.getByText('未 2')).toBeVisible();
  await expect(page.getByText('可 1')).toBeVisible();
  await expect(page.getByTestId('self-inspection-selected-slot-status')).toContainText('検査員測定可能');
  await expect(page.getByRole('button', { name: '2：作業者未確定。作業者が「入力を保存」すると検査できます' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '状況更新' })).toBeVisible();

  const pane = page.getByTestId('self-inspection-session-right-pane');
  const metrics = await pane.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});
