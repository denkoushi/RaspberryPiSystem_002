import { expect, test, type Page } from '@playwright/test';

const CLIENT_KEY = 'client-key-raspberrypi4-kiosk1';
const DRAWING_PATH = '/api/storage/part-measurement-drawings/layout-e2e.svg';

const visualTemplate = {
  id: 'layout-visual-1',
  name: '図面71-A61',
  drawingImageRelativePath: DRAWING_PATH,
  isActive: true,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z'
};

const drawingTemplate = {
  id: 'layout-template-1',
  fhincd: 'PART-9000',
  resourceCd: 'R001',
  processGroup: 'cutting',
  name: '図面71-A61 テンプレート',
  version: 1,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: visualTemplate.id,
  visualTemplate,
  siblingGroupId: null,
  siblingGroup: null,
  itemCount: 1,
  updatedAt: '2026-07-14T00:00:00.000Z'
};

function makeSession(index: number, status: 'in_progress' | 'review_pending') {
  const suffix = String(index + 1).padStart(2, '0');
  return {
    id: `layout-session-${suffix}`,
    sessionBusinessKey: `layout-business-${suffix}`,
    templateId: `layout-template-${suffix}`,
    templateName: `自主検査 ${suffix}`,
    productNo: `ORDER-${suffix}`,
    fseiban: `SEIBAN-${suffix}`,
    fhincd: `PART-${suffix}`,
    fhinmei: `レイアウト確認部品 ${suffix}`,
    processGroup: 'cutting',
    resourceCd: `R-${(index % 4) + 1}`,
    scheduleRowId: `schedule-${suffix}`,
    machineName: `設備 ${(index % 3) + 1}`,
    plannedQuantity: 10 + index,
    expectedEntryCount: 10 + index,
    requiredEntryCount: 10 + index,
    completedEntryCount: index % 7,
    pendingReviewCount: status === 'review_pending' ? 1 : 0,
    participantEmployeeNames: [`担当者 ${suffix}`],
    participantEmployees: [
      { employeeId: `employee-${suffix}`, displayName: `担当者 ${suffix}` }
    ],
    selfInspectionMode: 'all',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    status,
    startedAt: '2026-07-14T00:00:00.000Z',
    completedAt: null,
    recordApprovalRequiredAt: status === 'review_pending' ? '2026-07-14T01:00:00.000Z' : null,
    recordApprovalWorkflowStartedAt: status === 'review_pending' ? '2026-07-14T01:00:00.000Z' : null,
    inspectorRemeasurementRequiredAt: null,
    inspectorMeasurementState: 'not_required',
    inspectorRequiredEntryCount: 0,
    inspectorCompletedRequiredEntryCount: 0,
    inspectorMissingRequiredEntryCount: 0,
    inspectorIncompleteValueEntryCount: 0,
    updatedAt: `2026-07-14T${String(23 - index).padStart(2, '0')}:00:00.000Z`
  };
}

async function installApiMocks(page: Page): Promise<void> {
  const inProgress = Array.from({ length: 8 }, (_, index) => makeSession(index, 'in_progress'));
  const reviewPending = Array.from({ length: 4 }, (_, index) =>
    makeSession(index + 8, 'review_pending')
  );

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/system/deploy-status') {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }
    if (path === '/api/kiosk/config') {
      await route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
      return;
    }
    if (path === '/api/kiosk/call/targets') {
      await route.fulfill({ json: { selfClientId: 'layout-e2e', targets: [] } });
      return;
    }
    if (path === '/api/part-measurement/self-inspection/sessions') {
      const sessions = url.searchParams.get('status') === 'review_pending'
        ? reviewPending
        : inProgress;
      await route.fulfill({ json: { sessions, truncated: false, listLimit: 200 } });
      return;
    }
    if (path === '/api/kiosk/production-schedule/resources') {
      await route.fulfill({ json: { resources: ['R001'], resourceNameMap: {} } });
      return;
    }
    if (path === '/api/part-measurement/inspection-drawing/templates') {
      await route.fulfill({ json: { templates: [drawingTemplate] } });
      return;
    }
    if (path === '/api/part-measurement/visual-templates') {
      await route.fulfill({ json: { visualTemplates: [visualTemplate] } });
      return;
    }
    if (path === DRAWING_PATH) {
      await route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#e2e8f0"/><text x="80" y="190" font-size="48">71-A61</text></svg>',
        contentType: 'image/svg+xml'
      });
      return;
    }

    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });
}

async function openSelfInspection(page: Page): Promise<void> {
  await installApiMocks(page);
  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);
  await page.goto('/kiosk/part-measurement/self-inspection', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('仕掛中を読込中…')).toHaveCount(0);
  await expect(page.getByTestId('self-inspection-table-panes')).toBeVisible();
}

test.describe('自主検査一覧の表レイアウト', () => {
  for (const viewport of [
    { width: 1280, height: 760, panes: 2 },
    { width: 1536, height: 864, panes: 3 },
    { width: 1920, height: 1080, panes: 3 }
  ]) {
    test(`${viewport.width}x${viewport.height} で ${viewport.panes} ペインと1行ヘッダーを維持する`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openSelfInspection(page);

      const panes = page.getByTestId('self-inspection-table-panes');
      await expect(panes).toHaveAttribute('data-pane-count', String(viewport.panes));
      await expect(panes.locator('table')).toHaveCount(viewport.panes);

      const header = page.getByRole('heading', { name: '自主検査', exact: true }).locator('..');
      const headerMetrics = await header.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }));
      expect(headerMetrics.height).toBe(60);
      expect(headerMetrics.scrollWidth).toBeLessThanOrEqual(headerMetrics.clientWidth + 1);

      await expect(page.getByText(/仕掛中（全端末共通）を表示します/)).toHaveCount(0);
      await expect(page.getByText(/仕掛中（.*全端末共通/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: '移動票スキャン' })).toBeVisible();
      await expect(page.getByRole('button', { name: '氏名スキャン' })).toBeVisible();
      await expect(page.getByRole('button', { name: '記録承認' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: '製造order / 製番 / 品番' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: '資源CD' })).toBeVisible();

      const controlHeights = await header
        .locator('button, input')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(controlHeights.every((height) => height >= 44)).toBe(true);

      const productNos = await panes
        .locator('tbody tr:nth-child(odd) td:first-child')
        .allTextContents();
      expect(productNos).toEqual(Array.from({ length: 12 }, (_, index) => `ORDER-${String(index + 1).padStart(2, '0')}`));

      const screenshotDir = process.env.SELF_INSPECTION_E2E_SCREENSHOT_DIR?.replace(/\/$/, '');
      if (screenshotDir) {
        await page.screenshot({
          path: `${screenshotDir}/self-inspection-${viewport.width}x${viewport.height}.png`,
          fullPage: true
        });
      }
    });
  }
});

test('検査図面タイトルバーから指定2ボタンだけを削除する', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await installApiMocks(page);
  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);
  await page.goto('/kiosk/part-measurement/inspection', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('図面71-A61').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '部品測定へ' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '新規', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '図面名数字テンキー' })).toBeVisible();
  await expect(page.getByRole('link', { name: '雛形' })).toBeVisible();

  const titleBar = page.getByRole('heading', { name: '検査図面', exact: true }).locator('..').locator('..');
  const titleBarMetrics = await titleBar.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(titleBarMetrics.height).toBe(60);
  expect(titleBarMetrics.scrollWidth).toBeLessThanOrEqual(titleBarMetrics.clientWidth + 1);

  const screenshotDir = process.env.SELF_INSPECTION_E2E_SCREENSHOT_DIR?.replace(/\/$/, '');
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/inspection-drawing-1536x864.png`, fullPage: true });
  }
});
