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

const explicitProcedureSequence = {
  mode: 'configured',
  source: 'template_version',
  reason: null,
  machineName: 'MH-E2E',
  machineNameKey: 'MH-E2E',
  documents: [
    {
      orderItemId: 'procedure-item-e2e',
      sortOrder: 0,
      label: null,
      documentType: 'assembly_procedure_document',
      kioskDocumentId: null,
      assemblyProcedureDocumentId: 'procedure-e2e',
      title: 'E2E 手順書',
      displayTitle: null,
      filename: 'E2E 手順書',
      confirmedDocumentNumber: null,
      confirmedSummaryText: null,
      pageCount: 1,
      updatedAt: timestamp,
      pageUrls: [procedureImage],
      pages: [
        {
          source: 'assembly_procedure_document',
          documentId: 'procedure-e2e',
          pageIndex: 0,
          pageUrl: procedureImage
        }
      ]
    }
  ],
  stepSource: 'template_steps',
  steps: [
    {
      id: 'crop-step',
      sortOrder: 0,
      kioskDocumentId: null,
      assemblyProcedureDocumentId: 'procedure-e2e',
      pageIndex: 0,
      viewMode: 'crop',
      cropXRatio: 0.25,
      cropYRatio: 0.25,
      cropWidthRatio: 0.5,
      cropHeightRatio: 0.5,
      title: '中央を重点確認',
      instructionText: '丸数字1を確認してから締め付ける',
      emphasis: 'caution',
      documentType: 'assembly_procedure_document',
      documentTitle: 'E2E 手順書',
      pageUrl: procedureImage
    },
    {
      id: 'full-step',
      sortOrder: 1,
      kioskDocumentId: null,
      assemblyProcedureDocumentId: 'procedure-e2e',
      pageIndex: 0,
      viewMode: 'full_page',
      cropXRatio: null,
      cropYRatio: null,
      cropWidthRatio: null,
      cropHeightRatio: null,
      title: '全体を再確認',
      instructionText: '周辺部品との位置関係を見る',
      emphasis: 'important',
      documentType: 'assembly_procedure_document',
      documentTitle: 'E2E 手順書',
      pageUrl: procedureImage
    }
  ],
  fallbackProcedureDocument: null
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

async function mockAssemblyApis(
  page: Page,
  evidence: ApiEvidence,
  procedureSequence: Record<string, unknown> = fallbackProcedureSequence
): Promise<void> {
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
      await route.fulfill({ json: { sequence: procedureSequence } });
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

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 900, height: 900 }
]) {
  test(`explicit work steps keep crop markers aligned and navigate at ${viewport.width}x${viewport.height}`, async ({
    page
  }) => {
    const evidence: ApiEvidence = {
      operatorAccessBodies: [],
      procedureRequestCount: 0
    };
    await page.setViewportSize(viewport);
    await installMockNfcWebSocket(page);
    await mockAssemblyApis(page, evidence, explicitProcedureSequence);
    await page.goto(`/kiosk/assembly/work-sessions/${inProgressSession.id}`, {
      waitUntil: 'networkidle'
    });
    await emitNfc(page, `NFC-STEPS-${viewport.width}`);

    await expect(page.getByText('手順 1/2 · 中央を重点確認')).toBeVisible();
    await expect(page.getByText('丸数字1を確認してから締め付ける')).toBeVisible();
    await expect(page.getByText('⚠ 注意 · 中央を重点確認')).toBeVisible();
    const cropView = page.getByTestId('assembly-procedure-crop-view');
    const marker = cropView.getByRole('button', { name: 'BOLT-E2E' });
    await expect(cropView).toBeVisible();
    await expect(marker).toBeVisible();
    await expect(page.getByTestId('assembly-procedure-crop-minimap')).toBeVisible();
    const alignment = await cropView.evaluate((element, markerElement) => {
      const cropRect = element.getBoundingClientRect();
      const markerRect = (markerElement as HTMLElement).getBoundingClientRect();
      return {
        xError: Math.abs(
          markerRect.left + markerRect.width / 2 - (cropRect.left + cropRect.width / 2)
        ),
        yError: Math.abs(
          markerRect.top + markerRect.height / 2 - (cropRect.top + cropRect.height / 2)
        )
      };
    }, await marker.elementHandle());
    expect(alignment.xError).toBeLessThanOrEqual(1);
    expect(alignment.yError).toBeLessThanOrEqual(1);

    if (viewport.width >= 1366) {
      await expect(page.getByTestId('assembly-work-step-storyboard')).toBeVisible();
    } else {
      await expect(page.getByTestId('assembly-work-step-storyboard')).toHaveCount(0);
      await page.getByRole('button', { name: '全手順' }).click();
      await expect(page.getByTestId('assembly-work-step-storyboard')).toBeVisible();
    }
    await expect(page.getByLabel('文書区間の全体マップ')).toBeVisible();

    for (const buttonName of ['全手順', '現在の丸数字へ', '前手順', '次手順']) {
      const button = page.getByRole('button', { name: buttonName, exact: true });
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }

    await page.getByRole('button', { name: '全体を一時表示' }).click();
    await expect(page.getByTestId('assembly-procedure-image-with-markers')).toBeVisible();
    await expect(page.getByTestId('assembly-procedure-crop-view')).toHaveCount(0);
    await page.getByRole('button', { name: '矩形へ戻る' }).click();
    await expect(cropView).toBeVisible();
    await page.getByRole('button', { name: '次手順' }).click();
    await expect(page.getByText('手順 2/2 · 全体を再確認')).toBeVisible();
    await page.getByRole('button', { name: '前手順' }).click();
    await expect(page.getByText('手順 1/2 · 中央を重点確認')).toBeVisible();

    const pageOverflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.clientWidth + 1);
  });
}
