import { expect, test, type Page, type TestInfo } from '@playwright/test';

const LINUX_KIOSK_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '55555555-5555-4555-8555-555555555555';
const BOLT_ID = '77777777-7777-4777-8777-777777777777';
const AREA_ID = '88888888-8888-4888-8888-888888888888';
const CONDITION_FINGERPRINT = 'optional-bolt-condition-fingerprint';
const SERIAL_NUMBER = 'OPTIONAL-BOLT-01';
const PROCEDURE_IMAGE_PATH = '/api/storage/assembly-procedure-images/optional-bolt.svg';
const PROCEDURE_IMAGE_BODY = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#f8fafc"/></svg>';
const timestamp = '2026-08-27T00:00:00.000Z';

const procedureSequence = {
  mode: 'fallback',
  source: 'primary_fallback',
  reason: 'not_configured',
  machineName: 'OPTIONAL-BOLT-MODEL',
  machineNameKey: 'OPTIONAL-BOLT-MODEL',
  documents: [{
    orderItemId: '',
    sortOrder: 0,
    label: null,
    documentType: 'assembly_procedure_document',
    kioskDocumentId: null,
    assemblyProcedureDocumentId: 'procedure-optional-bolt',
    title: 'Optional BOLT 手順書',
    displayTitle: null,
    filename: 'optional-bolt.svg',
    confirmedDocumentNumber: null,
    confirmedSummaryText: null,
    pageCount: 1,
    updatedAt: timestamp,
    pageUrls: [PROCEDURE_IMAGE_PATH],
    pages: [{
      source: 'assembly_procedure_document',
      documentId: 'procedure-optional-bolt',
      pageIndex: 0,
      pageUrl: PROCEDURE_IMAGE_PATH
    }]
  }],
  stepSource: 'document_expansion',
  steps: [{
    id: 'optional-bolt-step',
    sortOrder: 0,
    kioskDocumentId: null,
    assemblyProcedureDocumentId: 'procedure-optional-bolt',
    pageIndex: 0,
    viewMode: 'full_page',
    cropXRatio: null,
    cropYRatio: null,
    cropWidthRatio: null,
    cropHeightRatio: null,
    title: null,
    instructionText: null,
    emphasis: 'normal',
    documentType: 'assembly_procedure_document',
    documentTitle: 'Optional BOLT 手順書',
    pageUrl: PROCEDURE_IMAGE_PATH
  }],
  fallbackProcedureDocument: {
    id: 'procedure-optional-bolt',
    name: 'Optional BOLT 手順書',
    imageRelativePath: PROCEDURE_IMAGE_PATH
  }
};

function makeSession() {
  const bolt = {
    id: BOLT_ID,
    areaId: AREA_ID,
    templateId: '99999999-9999-4999-8999-999999999999',
    sortOrder: 0,
    tighteningId: 'OPTIONAL-BOLT-1',
    markerNo: 1,
    xRatio: '0.5',
    yRatio: '0.5',
    calloutTipXRatio: null,
    calloutTipYRatio: null,
    boltSpec: 'M10x35 SCM435 10.9',
    nominalDiameter: 'M10',
    boltLengthMm: '35',
    material: 'SCM435',
    strengthClass: '10.9',
    capabilityGroupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    nominalTorque: '30',
    lowerLimit: '28',
    upperLimit: '32',
    unit: 'N-m',
    kioskDocumentId: null,
    assemblyProcedureDocumentId: 'procedure-optional-bolt',
    pageIndex: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const area = {
    id: AREA_ID,
    templateId: bolt.templateId,
    sortOrder: 0,
    processNo: '1',
    areaCode: 'A',
    areaName: 'Optional BOLT 締付',
    unitCode: 'U1',
    requireManualAdvance: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    bolts: [bolt]
  };
  return {
    id: SESSION_ID,
    workUnitId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    lotSerialId: null,
    templateId: bolt.templateId,
    status: 'in_progress',
    productNo: 'OPTIONAL-BOLT-PRODUCT',
    workId: 'OPTIONAL-BOLT-WORK',
    serialNo: 'OPTIONAL-BOLT-WORK',
    nameplateNo: 'OPTIONAL-BOLT-NAMEPLATE',
    operatorEmployeeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    operatorNameSnapshot: 'BOLT E2E 作業者',
    targetUnit: 'OPTIONAL',
    torqueWrenchId: PROFILE_ID,
    clientDeviceId: null,
    clientDeviceNameSnapshot: 'BOLT E2E kiosk',
    currentAreaId: AREA_ID,
    currentBoltId: BOLT_ID,
    startedAt: timestamp,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    template: {
      id: bolt.templateId,
      modelCode: 'OPTIONAL-BOLT-MODEL',
      procedurePattern: '標準',
      name: 'Optional BOLT assembly',
      traceabilityMode: 'REQUIRED',
      version: 1,
      isActive: true,
      procedureDocumentId: 'procedure-optional-bolt',
      createdAt: timestamp,
      updatedAt: timestamp,
      procedureDocument: {
        id: 'procedure-optional-bolt',
        name: 'Optional BOLT 手順書',
        imageRelativePath: PROCEDURE_IMAGE_PATH,
        status: 'published',
        publishedAt: timestamp,
        isActive: true,
        pages: [],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      areas: [area],
      checkItems: []
    },
    torqueRecords: [],
    restartLogs: [],
    approval: null,
    areaTorqueSummaries: [],
    checkItems: [],
    checkSummary: {
      requiredTotal: 0,
      requiredCompleted: 0,
      allRequiredCompleted: true
    }
  };
}

const compatibleWrenches = [{
  profile: {
    id: PROFILE_ID,
    serialNumber: SERIAL_NUMBER,
    model: {
      modelNumber: 'OPTIONAL-BOLT-WRENCH',
      settingVerificationMode: 'BOLT_CONDITION_ONLY'
    },
    settingHistories: []
  },
  conditionFingerprint: CONDITION_FINGERPRINT
}];

type MockState = {
  session: ReturnType<typeof makeSession>;
  operatorAccessBodies: Array<Record<string, unknown>>;
  confirmationBodies: Array<Record<string, unknown>>;
  confirmationIds: string[];
  acquireBodies: Array<Record<string, unknown>>;
  releaseBodies: Array<Record<string, unknown>>;
  agentOwned: boolean;
  leaseGeneration: number;
};

function makeAgentStatus(state: MockState, overrides: Record<string, unknown> = {}) {
  const latestAcquire = state.acquireBodies.at(-1);
  return {
    ok: true,
    ready: state.agentOwned,
    state: state.agentOwned ? 'owned_by_self' : 'available',
    owner: null,
    bound: state.agentOwned,
    leaseOwned: state.agentOwned,
    bluetoothPowered: state.agentOwned,
    hidExclusive: state.agentOwned,
    lastError: null,
    wrenchSerialNumbers: [SERIAL_NUMBER],
    ...(state.agentOwned && latestAcquire ? {
      selfOwnedToken: {
        targetKind: 'assembly',
        sessionId: SESSION_ID,
        torqueWrenchProfileId: PROFILE_ID,
        leaseId: `optional-bolt-lease-${state.leaseGeneration}`,
        generation: state.leaseGeneration
      }
    } : {}),
    ...overrides
  };
}

async function installMockNfc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type MockSocket = {
      readyState: number;
      onmessage: ((event: MessageEvent<string>) => void) | null;
    };
    type TestWindow = Window & {
      __emitAssemblyOptionalNfc?: (uid: string) => void;
      __assemblyOptionalNfcReady?: boolean;
    };
    const sockets: MockSocket[] = [];
    class MockWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(_url: string | URL) {
        sockets.push(this);
        window.setTimeout(() => {
          this.onopen?.();
          (window as TestWindow).__assemblyOptionalNfcReady = true;
        }, 0);
      }

      send() {}

      close() {
        this.onclose?.();
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: MockWebSocket });
    (window as TestWindow).__assemblyOptionalNfcReady = false;
    (window as TestWindow).__emitAssemblyOptionalNfc = (uid) => {
      const payload = JSON.stringify({
        uid,
        timestamp: new Date(Date.now() + 10_000).toISOString()
      });
      for (const socket of sockets) {
        if (socket.readyState === MockWebSocket.OPEN) {
          socket.onmessage?.(new MessageEvent('message', { data: payload }));
        }
      }
    };
  });
}

async function emitNfc(page: Page, uid: string): Promise<void> {
  await page.evaluate((value) => {
    (window as Window & { __emitAssemblyOptionalNfc?: (nextUid: string) => void })
      .__emitAssemblyOptionalNfc?.(value);
  }, uid);
}

async function mockAssemblyApis(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.startsWith('/src/api/')) {
      await route.continue();
      return;
    }
    if (path === '/api/kiosk/config') {
      await route.fulfill({ json: { kioskInitialRoute: 'assembly', navTabOrder: [] } });
      return;
    }
    if (path === '/api/kiosk/call/targets') {
      await route.fulfill({ json: { selfClientId: 'assembly-optional-e2e', targets: [] } });
      return;
    }
    if (path === '/api/system/deploy-status') {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }
    if (path === PROCEDURE_IMAGE_PATH && request.method() === 'GET') {
      await route.fulfill({ contentType: 'image/svg+xml', body: PROCEDURE_IMAGE_BODY });
      return;
    }
    if (path === `/api/assembly/work-sessions/${SESSION_ID}` && request.method() === 'GET') {
      await route.fulfill({ json: { session: state.session } });
      return;
    }
    if (path === `/api/assembly/work-sessions/${SESSION_ID}/operator-access` && request.method() === 'POST') {
      state.operatorAccessBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { session: state.session } });
      return;
    }
    if (path === `/api/assembly/work-sessions/${SESSION_ID}/procedure-sequence`) {
      await route.fulfill({ json: { sequence: procedureSequence } });
      return;
    }
    if (path === `/api/assembly/work-sessions/${SESSION_ID}/compatible-torque-wrenches`) {
      await route.fulfill({ json: { torqueWrenches: compatibleWrenches } });
      return;
    }
    if (path === `/api/assembly/work-sessions/${SESSION_ID}/torque-wrench-confirmations/current`) {
      await route.fulfill({ json: { confirmations: [] } });
      return;
    }
    if (path === `/api/assembly/work-sessions/${SESSION_ID}/torque-wrench-confirmations` && request.method() === 'POST') {
      state.confirmationBodies.push(request.postDataJSON() as Record<string, unknown>);
      const confirmationId = `optional-bolt-confirmation-${state.confirmationBodies.length}`;
      state.confirmationIds.push(confirmationId);
      await route.fulfill({
        status: 201,
        json: {
          confirmation: {
            id: confirmationId,
            sessionId: SESSION_ID,
            torqueWrenchProfileId: PROFILE_ID,
            settingHistoryId: null,
            settingVerificationMode: 'BOLT_CONDITION_ONLY',
            conditionFingerprint: CONDITION_FINGERPRINT,
            target: {
              lowerLimit: '28',
              nominalTorque: '30',
              upperLimit: '32',
              unit: 'N-m'
            }
          }
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

async function mockTorqueAgent(page: Page, state: MockState): Promise<void> {
  await page.route('http://127.0.0.1:7073/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/health') {
      await route.fulfill({ json: makeAgentStatus(state) });
      return;
    }
    if (path === '/lease/acquire') {
      state.acquireBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      if (state.acquireBodies.length === 1) {
        await route.abort('failed');
        return;
      }
      state.agentOwned = true;
      state.leaseGeneration += 1;
      await route.fulfill({ json: makeAgentStatus(state) });
      return;
    }
    if (path === '/heartbeat') {
      await route.fulfill({ json: makeAgentStatus(state) });
      return;
    }
    if (path === '/lease/release') {
      state.releaseBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      state.agentOwned = false;
      await route.fulfill({ json: makeAgentStatus(state) });
      return;
    }
    await route.fulfill({ json: makeAgentStatus(state) });
  });
}

async function isWithinTighteningPane(locator: ReturnType<Page['getByRole']>): Promise<boolean> {
  return locator.evaluate((element) => {
    const pane = element.closest('section');
    if (!pane) {
      return false;
    }
    const elementRect = element.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    return elementRect.top >= paneRect.top - 1
      && elementRect.bottom <= paneRect.bottom + 1
      && elementRect.left >= paneRect.left - 1
      && elementRect.right <= paneRect.right + 1;
  });
}

async function assertTighteningPaneLayout(page: Page, viewportHeight: number): Promise<void> {
  const tighteningPane = page.getByRole('heading', { name: '締付', exact: true }).locator('..');
  const paneMetrics = await tighteningPane.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth
  }));
  expect(paneMetrics.overflowY).toBe('auto');
  expect(paneMetrics.scrollWidth).toBeLessThanOrEqual(paneMetrics.clientWidth + 1);
  if (viewportHeight <= 768) {
    expect(paneMetrics.scrollHeight).toBeGreaterThan(paneMetrics.clientHeight);
  }

  const documentMetrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(documentMetrics.scrollWidth).toBeLessThanOrEqual(documentMetrics.viewportWidth + 1);

  await tighteningPane.evaluate((element) => {
    element.scrollTop = 0;
  });
  const restartButton = page.getByRole('button', { name: 'やり直し', exact: true });
  await restartButton.scrollIntoViewIfNeeded();
  await expect.poll(() => isWithinTighteningPane(restartButton)).toBe(true);

  const historyHeading = page.getByRole('heading', { name: '履歴', exact: true });
  await historyHeading.scrollIntoViewIfNeeded();
  await expect.poll(() => isWithinTighteningPane(historyHeading)).toBe(true);
}

async function runOptionalSettingsFlow(page: Page, testInfo: TestInfo, viewport: { width: number; height: number }) {
  const state: MockState = {
    session: makeSession(),
    operatorAccessBodies: [],
    confirmationBodies: [],
    confirmationIds: [],
    acquireBodies: [],
    releaseBodies: [],
    agentOwned: false,
    leaseGeneration: 0
  };
  await page.setViewportSize(viewport);
  await installMockNfc(page);
  await mockAssemblyApis(page, state);
  await mockTorqueAgent(page, state);
  await page.goto(`/kiosk/assembly/work-sessions/${SESSION_ID}`, { waitUntil: 'networkidle' });

  await expect(page.getByRole('dialog', { name: '作業者確認' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as Window & { __assemblyOptionalNfcReady?: boolean }).__assemblyOptionalNfcReady
  ))).toBe(true);
  await emitNfc(page, `OPTIONAL-BOLT-NFC-${viewport.width}`);
  await expect.poll(() => state.operatorAccessBodies.length).toBe(1);

  const target = page.getByTestId('assembly-bolt-condition-target');
  await expect(target).toBeVisible();
  await expect(target).toContainText('設定照合対象外');
  await expect(target).toContainText(SERIAL_NUMBER);
  await expect(target).toContainText('M10x35 SCM435 10.9');
  await expect(target).toContainText('28 N-m');
  await expect(target).toContainText('30 N-m');
  await expect(target).toContainText('32 N-m');
  await expect(page.getByTestId('assembly-procedure-image-with-markers').locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByPlaceholder('トルク値')).toHaveCount(0);
  await expect(page.locator('input')).toHaveCount(0);

  await assertTighteningPaneLayout(page, viewport.height);
  const screenshotPath = testInfo.outputPath(`assembly-optional-settings-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const connect = page.getByTestId('assembly-bolt-connect');
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect.poll(() => state.confirmationBodies.length).toBe(1);
  await expect.poll(() => state.acquireBodies.length).toBe(1);
  await expect(page.getByTestId('assembly-work-session-status')).toHaveText('確認済み・接続を再試行');
  expect(state.confirmationBodies[0]).toMatchObject({
    expectedTemplateBoltId: BOLT_ID,
    torqueWrenchProfileId: PROFILE_ID,
    physicalDisplayConfirmed: true
  });

  await connect.click();
  await expect.poll(() => state.acquireBodies.length).toBe(2);
  await expect.poll(() => state.confirmationBodies.length).toBe(1);
  expect(state.acquireBodies[0]?.confirmationId).toBe(state.confirmationIds[0]);
  expect(state.acquireBodies[1]?.confirmationId).toBe(state.confirmationIds[0]);
  expect(state.acquireBodies[0]?.requestId).toBe(state.acquireBodies[1]?.requestId);
  await expect(page.getByText('入力待機中', { exact: true }).last()).toBeVisible();

  await page.getByRole('button', { name: '使用終了' }).click();
  await expect.poll(() => state.releaseBodies.length).toBe(1);
  expect(state.releaseBodies[0]).toMatchObject({
    targetKind: 'assembly',
    sessionId: SESSION_ID,
    torqueWrenchProfileId: PROFILE_ID,
    leaseId: 'optional-bolt-lease-1',
    generation: 1
  });
  await expect(page.getByTestId('assembly-bolt-connect')).toBeEnabled();
  await expect.poll(() => state.confirmationIds.length).toBe(1);

  await page.getByTestId('assembly-bolt-connect').click();
  await expect.poll(() => state.confirmationBodies.length).toBe(2);
  await expect.poll(() => state.acquireBodies.length).toBe(3);
  expect(state.confirmationIds[1]).not.toBe(state.confirmationIds[0]);
  expect(state.acquireBodies[2]?.confirmationId).toBe(state.confirmationIds[1]);
  expect(state.acquireBodies[2]?.requestId).not.toBe(state.acquireBodies[1]?.requestId);
  await expect(page.getByText('入力待機中', { exact: true }).last()).toBeVisible();

  await page.getByRole('button', { name: '使用終了' }).click();
  await expect.poll(() => state.releaseBodies.length).toBe(2);
}

test.use({ userAgent: LINUX_KIOSK_USER_AGENT });

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
]) {
  test(`BOLT assembly optional settings flow at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await runOptionalSettingsFlow(page, testInfo, viewport);
  });
}
