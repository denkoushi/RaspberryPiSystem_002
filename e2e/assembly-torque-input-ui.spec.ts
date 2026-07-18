import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
] as const;

function session(mode: 'LEGACY' | 'REQUIRED') {
  const records = [
    {
      id: 'record-old-ok', sessionId: mode, templateBoltId: 'bolt-1', attempt: 1, inputSource: 'manual', value: '90.1', inputUnit: 'kgf-cm', valueNm: null,
      judgement: 'ok', accepted: true, ignoredReason: null, recordedAt: '2026-07-18T00:00:00.000Z', createdAt: '2026-07-18T00:00:00.000Z', tighteningId: 'BOLT-11', markerNo: 11, areaId: 'area-1', areaName: 'ストッパー取付'
    },
    {
      id: 'record-current-ok', sessionId: mode, templateBoltId: 'bolt-2', attempt: 1, inputSource: 'manual', value: '89.8', inputUnit: 'kgf-cm', valueNm: null,
      judgement: 'ok', accepted: true, ignoredReason: null, recordedAt: '2026-07-18T00:01:00.000Z', createdAt: '2026-07-18T00:01:00.000Z', tighteningId: 'BOLT-13', markerNo: 13, areaId: 'area-1', areaName: 'ストッパー取付'
    },
    {
      id: 'record-current-ng', sessionId: mode, templateBoltId: 'bolt-2', attempt: 2, inputSource: 'manual', value: '78.0', inputUnit: 'kgf-cm', valueNm: null,
      judgement: 'ng', accepted: true, ignoredReason: null, recordedAt: '2026-07-18T00:02:00.000Z', createdAt: '2026-07-18T00:02:00.000Z', tighteningId: 'BOLT-13', markerNo: 13, areaId: 'area-1', areaName: 'ストッパー取付'
    },
    {
      id: 'record-unaccepted', sessionId: mode, templateBoltId: 'bolt-3', attempt: 1, inputSource: 'agent', value: '—', inputUnit: null, valueNm: null,
      judgement: 'ignored', accepted: false, ignoredReason: '校正期限切れ', recordedAt: '2026-07-18T00:03:00.000Z', createdAt: '2026-07-18T00:03:00.000Z', tighteningId: 'BOLT-14', markerNo: 14, areaId: 'area-1', areaName: 'ストッパー取付', serialNumberSnapshot: 'SERIAL_A'
    }
  ];
  return {
    id: mode.toLowerCase(), lotSerialId: null, templateId: 'template-1', status: 'in_progress', productNo: 'ASM-001', serialNo: 'S001', nameplateNo: 'S001',
    operatorEmployeeId: null, operatorNameSnapshot: '佐藤', targetUnit: 'MH-AX', torqueWrenchId: null, clientDeviceId: null, clientDeviceNameSnapshot: null,
    currentAreaId: 'area-1', currentBoltId: 'bolt-2', startedAt: '2026-07-18T00:00:00.000Z', completedAt: null, cancelledAt: null, cancelReason: null,
    createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', torqueRecords: records, restartLogs: [], checkItems: [],
    template: {
      id: 'template-1', modelCode: 'MH-AX', procedurePattern: '標準', name: 'MH-AX 標準', traceabilityMode: mode, version: 1, isActive: true,
      procedureDocumentId: 'procedure-1', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
      procedureDocument: { id: 'procedure-1', name: '組立手順書', imageRelativePath: '/api/storage/assembly-procedure-images/procedure.svg', isActive: true, createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z' },
      areas: [{
        id: 'area-1', templateId: 'template-1', sortOrder: 0, processNo: '7', areaCode: '13', areaName: 'ストッパー取付', unitCode: 'U1', requireManualAdvance: true,
        createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
        bolts: [
          { id: 'bolt-1', areaId: 'area-1', sortOrder: 0, tighteningId: 'BOLT-11', markerNo: 11, xRatio: '0.2', yRatio: '0.3', boltSpec: 'M8', nominalTorque: '90', lowerLimit: '81', upperLimit: '99', unit: 'kgf-cm', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z' },
          { id: 'bolt-2', areaId: 'area-1', sortOrder: 1, tighteningId: 'BOLT-13', markerNo: 13, xRatio: '0.5', yRatio: '0.5', boltSpec: 'M8', nominalTorque: '90', lowerLimit: '81', upperLimit: '99', unit: 'kgf-cm', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z' },
          { id: 'bolt-3', areaId: 'area-1', sortOrder: 2, tighteningId: 'BOLT-14', markerNo: 14, xRatio: '0.75', yRatio: '0.65', boltSpec: 'M8', nominalTorque: '90', lowerLimit: '81', upperLimit: '99', unit: 'kgf-cm', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z' }
        ]
      }]
    }
  };
}

async function mockWorkSession(page: Page, mode: 'LEGACY' | 'REQUIRED') {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:7073' && url.pathname === '/heartbeat') {
      return route.fulfill({ json: { ok: true } });
    }
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) return route.continue();
    if (pathname.includes('/system/deploy-status')) return route.fulfill({ json: { isMaintenance: false } });
    if (pathname.includes('/kiosk/config')) return route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
    if (pathname.includes('/kiosk/employees')) return route.fulfill({ json: { employees: [] } });
    if (pathname.includes('/kiosk/call/targets')) return route.fulfill({ json: { selfClientId: 'e2e', targets: [] } });
    if (pathname.endsWith(`/assembly/work-sessions/${mode.toLowerCase()}`)) return route.fulfill({ json: { session: session(mode) } });
    if (pathname.endsWith('/procedure-sequence')) return route.fulfill({ json: { sequence: { mode: 'fallback', reason: 'not_configured', machineName: 'MH-AX', machineNameKey: 'MH-AX', fallbackProcedureDocument: null, documents: [] } } });
    if (pathname.endsWith('/compatible-torque-wrenches')) {
      return route.fulfill({ json: { torqueWrenches: [{ profile: { id: 'profile-1', serialNumber: 'SERIAL_A', model: { modelNumber: 'CEM3-BTLA' }, settingHistories: [{ nominalTorque: '90', unit: 'kgf-cm' }] }, conditionFingerprint: 'condition-1' }] } });
    }
    if (pathname.endsWith('/torque-wrench-confirmations/current')) return route.fulfill({ json: { confirmations: [] } });
    if (pathname.endsWith('/procedure.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#dce3ed"/></svg>' });
    return route.fulfill({ json: {} });
  });
}

for (const viewport of viewports) {
  for (const mode of ['LEGACY', 'REQUIRED'] as const) {
    test(`torque input remains compact and readable for ${mode} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockWorkSession(page, mode);
      await page.goto(`/kiosk/assembly/work-sessions/${mode.toLowerCase()}`, { waitUntil: 'networkidle' });

      const panel = page.locator('[aria-label="締付入力ペイン"]');
      await expect(panel).toBeVisible();
      await expect(panel.getByLabel('現在の締付条件')).toContainText('丸数字 13');
      await expect(panel).toContainText('規定 90');
      await expect(panel).toContainText('許容 81–99');
      await expect(page.getByRole('button', { name: 'BOLT-13、NG・再入力' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'BOLT-14、未受付' })).toBeVisible();
      await expect(page.getByLabel('丸数字の状態凡例')).toBeVisible();
      await expect(panel.getByText('NG 78.0 kgf-cm。同じ丸数字を再入力してください。')).toBeVisible();
      await expect(panel.getByText('OK').first()).toBeVisible();
      await expect(panel.getByText('NG', { exact: true })).toBeVisible();
      await expect(panel.getByText('未受付')).toBeVisible();

      if (mode === 'LEGACY') {
        await expect(panel.getByRole('textbox', { name: 'トルク値' })).toBeVisible();
        await expect(panel.getByRole('button', { name: '記録' })).toBeVisible();
      } else {
        await expect(panel.getByRole('textbox', { name: 'トルク値' })).toHaveCount(0);
        await expect(panel.getByText('トルクエージェント')).toBeVisible();
        await expect(panel.getByText('接続済み')).toBeVisible();
      }

      const geometry = await page.evaluate(() => {
        const workflow = document.querySelector('[aria-label="工程操作"]');
        const panelElement = document.querySelector('[aria-label="締付入力ペイン"]');
        const buttons = Array.from(workflow?.querySelectorAll('button') ?? []);
        return {
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          panelWidth: panelElement?.getBoundingClientRect().width ?? 0,
          buttonSizes: buttons.map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
          historyFontSize: Number.parseFloat(getComputedStyle(document.querySelector('[aria-label="トルク入力履歴"] strong') ?? document.body).fontSize)
        };
      });
      expect(geometry.horizontalOverflow).toBe(false);
      expect(geometry.buttonSizes.every((item) => item.height >= 44 && item.width < geometry.panelWidth)).toBe(true);
      expect(geometry.historyFontSize).toBeGreaterThanOrEqual(16);
    });
  }
}
