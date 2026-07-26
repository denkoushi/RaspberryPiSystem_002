import { expect, test, type Page } from '@playwright/test';

const LINUX_KIOSK_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const timestamp = '2026-07-26T00:00:00.000Z';
const procedureImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="600"%3E%3Crect width="800" height="600" fill="%23f8fafc"/%3E%3C/svg%3E';

const inProgressSession = {
  id: '11111111-1111-4111-8111-111111111111',
  workUnitId: '22222222-2222-4222-8222-222222222222',
  lotSerialId: '33333333-3333-4333-8333-333333333333',
  templateId: '44444444-4444-4444-8444-444444444444',
  status: 'in_progress',
  productNo: 'ASM-E2E-001',
  workId: 'ASM-E2E-001-001',
  serialNo: 'ASM-E2E-001-001',
  nameplateNo: 'ASM-E2E-001-001',
  operatorEmployeeId: '55555555-5555-4555-8555-555555555555',
  operatorNameSnapshot: 'E2E 作業者',
  targetUnit: 'MH-E2E',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  clientDeviceId: null,
  clientDeviceNameSnapshot: 'E2E kiosk',
  currentAreaId: 'area-e2e',
  currentBoltId: 'bolt-e2e',
  startedAt: timestamp,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  template: {
    id: '44444444-4444-4444-8444-444444444444',
    modelCode: 'MH-E2E',
    procedurePattern: '標準',
    name: 'MH-E2E 標準',
    traceabilityMode: 'LEGACY',
    version: 1,
    isActive: true,
    procedureDocumentId: 'procedure-e2e',
    createdAt: timestamp,
    updatedAt: timestamp,
    procedureDocument: {
      id: 'procedure-e2e',
      name: 'E2E 手順書',
      imageRelativePath: procedureImage,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    areas: [
      {
        id: 'area-e2e',
        templateId: '44444444-4444-4444-8444-444444444444',
        sortOrder: 0,
        processNo: '1',
        areaCode: 'A',
        areaName: 'E2E 工程',
        unitCode: 'U1',
        requireManualAdvance: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        bolts: [
          {
            id: 'bolt-e2e',
            areaId: 'area-e2e',
            sortOrder: 0,
            tighteningId: 'BOLT-E2E',
            markerNo: 1,
            xRatio: '0.5',
            yRatio: '0.5',
            boltSpec: 'M8',
            nominalTorque: '10',
            lowerLimit: '9',
            upperLimit: '11',
            unit: 'N-m',
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ]
      }
    ]
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

const fallbackProcedureSequence = {
  mode: 'fallback',
  source: 'primary_fallback',
  reason: 'not_configured',
  machineName: 'MH-E2E',
  machineNameKey: 'MH-E2E',
  documents: [],
  fallbackProcedureDocument: {
    id: 'procedure-e2e',
    name: 'E2E 手順書',
    imageRelativePath: procedureImage
  }
};

type ApiEvidence = {
  operatorAccessBodies: Array<Record<string, unknown>>;
  procedureRequestCount: number;
};

async function installMockNfcWebSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type TestWindow = Window & {
      __emitAssemblyNfc?: (uid: string) => void;
    };
    type MockSocket = {
      readyState: number;
      onmessage: ((event: MessageEvent<string>) => void) | null;
    };

    const sockets: MockSocket[] = [];
    class MockWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readonly url: string;
      readyState = MockWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        this.url = String(url);
        sockets.push(this);
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: MockWebSocket
    });
    (window as TestWindow).__emitAssemblyNfc = (uid: string) => {
      const payload = JSON.stringify({
        uid,
        timestamp: new Date(Date.now() + 1_000).toISOString()
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
    const testWindow = window as Window & {
      __emitAssemblyNfc?: (nextUid: string) => void;
    };
    testWindow.__emitAssemblyNfc?.(value);
  }, uid);
}

async function mockAssemblyApis(page: Page, evidence: ApiEvidence): Promise<void> {
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
      await route.fulfill({ json: { selfClientId: 'assembly-e2e', targets: [] } });
      return;
    }
    if (path === '/api/system/deploy-status') {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }
    if (path.endsWith('/procedure-sequence')) {
      evidence.procedureRequestCount += 1;
      await route.fulfill({ json: { sequence: fallbackProcedureSequence } });
      return;
    }
    if (path.endsWith('/operator-access') && request.method() === 'POST') {
      evidence.operatorAccessBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        json: {
          session: {
            ...inProgressSession,
            operatorNameSnapshot: '再開作業者'
          }
        }
      });
      return;
    }
    if (
      path === `/api/assembly/work-sessions/${inProgressSession.id}` &&
      request.method() === 'GET'
    ) {
      await route.fulfill({ json: { session: inProgressSession } });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test.use({ userAgent: LINUX_KIOSK_USER_AGENT });

test('direct open and reload require a fresh NFC scan before procedure side effects', async ({
  page
}) => {
  const evidence: ApiEvidence = {
    operatorAccessBodies: [],
    procedureRequestCount: 0
  };
  await installMockNfcWebSocket(page);
  await mockAssemblyApis(page, evidence);

  await page.goto(`/kiosk/assembly/work-sessions/${inProgressSession.id}`, {
    waitUntil: 'networkidle'
  });

  await expect(page.getByRole('dialog', { name: '作業者確認' })).toBeVisible();
  expect(evidence.procedureRequestCount).toBe(0);
  await expect(page.getByPlaceholder('トルク値')).toHaveCount(0);

  await emitNfc(page, 'NFC-E2E-START');
  await expect.poll(() => evidence.operatorAccessBodies.length).toBe(1);
  expect(evidence.operatorAccessBodies[0]).toMatchObject({
    operatorNfcTagUid: 'NFC-E2E-START'
  });
  expect(evidence.operatorAccessBodies[0]?.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  await expect(page.getByPlaceholder('トルク値')).toBeVisible();
  await expect.poll(() => evidence.procedureRequestCount).toBe(1);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: '作業者確認' })).toBeVisible();
  expect(evidence.procedureRequestCount).toBe(1);

  await emitNfc(page, 'NFC-E2E-RELOAD');
  await expect.poll(() => evidence.operatorAccessBodies.length).toBe(2);
  expect(evidence.operatorAccessBodies[1]).toMatchObject({
    operatorNfcTagUid: 'NFC-E2E-RELOAD'
  });
  await expect(page.getByPlaceholder('トルク値')).toBeVisible();
  await expect.poll(() => evidence.procedureRequestCount).toBe(2);
});

test('immersive header reveals only inside the bottom-right 24px zone', async ({ page }) => {
  const evidence: ApiEvidence = {
    operatorAccessBodies: [],
    procedureRequestCount: 0
  };
  await installMockNfcWebSocket(page);
  await mockAssemblyApis(page, evidence);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/kiosk/assembly/work-sessions/${inProgressSession.id}`, {
    waitUntil: 'networkidle'
  });

  const header = page.locator('header').first();
  await page.mouse.move(640, 718);
  await expect(header).toHaveClass(/invisible/);

  await page.mouse.move(1278, 718);
  await expect(header).toHaveClass(/translate-y-0/);
  await expect(header).not.toHaveClass(/invisible/);
});
