import { expect, test, type Page } from '@playwright/test';

import { mockKioskLayoutApis } from './helpers/inspectionDrawingCreateHeaderLayout';

const CLIENT_KEY = 'client-key-raspberrypi4-kiosk1';
const SOP_SHEETS = [
  'library-entry-search',
  'library-visual-management',
  'library-template-management',
  'edit-basics',
  'edit-required-point',
  'edit-advanced-point',
  'edit-point-management',
  'edit-trial-report',
  'edit-group-history'
] as const;

const visualTemplate = {
  id: 'sop-visual-1',
  name: '図面71-A61',
  drawingImageRelativePath: '/api/storage/part-measurement-drawings/sop-visual-1.svg',
  isActive: true,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z'
};

const drawingTemplate = {
  id: 'sop-template-1',
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
  updatedAt: '2026-07-28T00:00:00.000Z'
};

async function installLibraryApiMocks(page: Page): Promise<void> {
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
      await route.fulfill({ json: { selfClientId: 'sop-e2e', targets: [] } });
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
    if (path === visualTemplate.drawingImageRelativePath) {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#e2e8f0"/></svg>'
      });
      return;
    }

    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 }
] as const) {
  test(`@production-smoke ${viewport.width}x${viewport.height}: 一覧の取説はオフラインでも生成シートを安全に表示する`, async ({
    page,
    context
  }) => {
    await page.setViewportSize(viewport);
    await installLibraryApiMocks(page);
    await page.goto('/kiosk/part-measurement/inspection', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('図面71-A61').first()).toBeVisible();

    const openButton = page.getByRole('button', { name: 'この画面の操作手順を開く' });
    await expect(openButton).toBeVisible();
    expect(await openButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    const titleBar = page.getByRole('heading', { name: '検査図面', exact: true }).locator('..').locator('..');
    const titleBarMetrics = await titleBar.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(titleBarMetrics.height).toBe(60);
    expect(titleBarMetrics.scrollWidth).toBeLessThanOrEqual(titleBarMetrics.clientWidth + 1);

    const iframeRequests: string[] = [];
    page.on('request', (request) => {
      if (request.frame().parentFrame()) iframeRequests.push(request.url());
    });

    await context.setOffline(true);
    try {
      await openButton.click();
      const frameElement = page.getByTestId('kiosk-sop-frame');
      await expect(frameElement).toHaveAttribute('sandbox', 'allow-scripts');
      await expect(frameElement).toHaveAttribute('referrerpolicy', 'no-referrer');

      const frame = page.frameLocator('[data-testid="kiosk-sop-frame"]');
      await expect(frame.locator('.sheet[data-sheet="library-entry-search"]')).toBeVisible();
      await expect(frame.locator('.sheet[data-sheet="edit-basics"]')).toBeHidden();
      await expect(frame.getByText('検査図面を開く')).toBeVisible();
      await expect(frame.getByText('必須').first()).toBeVisible();
      await expect(frame.getByText('任意').first()).toBeVisible();

      await frame.locator('.sheet[data-sheet="library-entry-search"] .step-item[data-step="1"]').focus();
      await expect(frame.locator('.sheet[data-sheet="library-entry-search"] .leader-layer line[data-line="1"]')).toHaveCSS('opacity', '1');

      await page.getByRole('button', { name: '次の手順' }).click();
      await expect(frame.locator('.sheet[data-sheet="library-visual-management"]')).toBeVisible();
      await expect(frame.getByText('図面を登録')).toBeVisible();
      await expect(frame.locator('.sheet[data-sheet="library-visual-management"] .leader-layer line.is-active')).toHaveCount(0);

      await page.getByRole('button', { name: '前の手順' }).click();
      await expect(frame.locator('.sheet[data-sheet="library-entry-search"]')).toBeVisible();
      await expect(frame.locator('.sheet[data-sheet="library-entry-search"] .leader-layer line.is-active')).toHaveCount(0);

      const closeButton = page.getByRole('button', { name: '閉じる' });
      expect(await closeButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await closeButton.click();
      await expect(openButton).toBeFocused();

      await openButton.click();
      await expect(frame.locator('.sheet[data-sheet="library-entry-search"]')).toBeVisible();
      await frame.locator('body').press('Escape');
      await expect(frameElement).toBeHidden();
      await expect(openButton).toBeFocused();
    } finally {
      await context.setOffline(false);
    }

    expect(iframeRequests).toEqual([]);
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 }
] as const) {
  test(`${viewport.width}x${viewport.height}: 全取説カードの引出線はカード端と丸数字外周を結ぶ`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installLibraryApiMocks(page);
    await page.goto('/kiosk/part-measurement/inspection', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'この画面の操作手順を開く' }).click();

    const frameElement = page.getByTestId('kiosk-sop-frame');
    const frame = page.frameLocator('[data-testid="kiosk-sop-frame"]');
    for (const [sheetIndex, sheetId] of SOP_SHEETS.entries()) {
      const sheet = frame.locator(`.sheet[data-sheet="${sheetId}"]`);
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute('data-kiosk-sop-layout-ready', 'true');
      await expect(sheet.locator('.leader-layer line.is-active')).toHaveCount(0);

      const layout = await sheet.evaluate((element) => {
        const sheetRect = element.getBoundingClientRect();
        const stage = element.querySelector<HTMLElement>('.stage');
        if (!stage) throw new Error('SOP stage is missing');
        const stageRect = stage.getBoundingClientRect();
        const screenWidth = Number(stage.dataset.screenWidth);
        const screenHeight = Number(stage.dataset.screenHeight);
        const scale = Math.min(stageRect.width / screenWidth, stageRect.height / screenHeight);
        const imageWidth = screenWidth * scale;
        const imageHeight = screenHeight * scale;
        return {
          sheetWidth: sheetRect.width,
          sheetHeight: sheetRect.height,
          iframeWidth: window.innerWidth,
          iframeHeight: window.innerHeight,
          stageWidth: stageRect.width,
          stageHeight: stageRect.height,
          imageWidth,
          imageHeight,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight
        };
      });
      expect(layout.sheetWidth).toBeGreaterThanOrEqual(layout.iframeWidth - 1);
      expect(layout.sheetHeight).toBeGreaterThanOrEqual(layout.iframeHeight - 1);
      expect(layout.overflowX).toBeLessThanOrEqual(1);
      expect(layout.overflowY).toBeLessThanOrEqual(1);
      if (viewport.width === 1920) {
        expect(layout.imageWidth / layout.stageWidth).toBeGreaterThanOrEqual(0.9);
        expect(layout.imageHeight / layout.stageHeight).toBeGreaterThanOrEqual(0.9);
      }

      const cards = sheet.locator('.step-item');
      const cardCount = await cards.count();
      for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
        const step = String(cardIndex + 1);
        const card = cards.nth(cardIndex);
        await card.click();
        await sheet.locator('.stage').hover();
        await expect(card).toHaveAttribute('aria-pressed', 'true');
        await expect(sheet.locator('.leader-layer line.is-active')).toHaveCount(1);

        const geometry = await sheet.evaluate((element, selectedStep) => {
          const body = element.querySelector<HTMLElement>('.body');
          const cardNode = element.querySelector<HTMLElement>(`.step-item[data-step="${selectedStep}"]`);
          const pin = element.querySelector<HTMLElement>(`.pin[data-pin="${selectedStep}"]`);
          const line = element.querySelector<SVGLineElement>(`.leader-layer line[data-line="${selectedStep}"]`);
          const stage = element.querySelector<HTMLElement>('.stage');
          if (!body || !cardNode || !pin || !line || !stage) throw new Error('SOP geometry node is missing');
          const bodyRect = body.getBoundingClientRect();
          const cardRect = cardNode.getBoundingClientRect();
          const pinRect = pin.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();
          const x1 = Number(line.getAttribute('x1')) + bodyRect.left;
          const y1 = Number(line.getAttribute('y1')) + bodyRect.top;
          const x2 = Number(line.getAttribute('x2')) + bodyRect.left;
          const y2 = Number(line.getAttribute('y2')) + bodyRect.top;
          const pinCenterX = pinRect.left + pinRect.width / 2;
          const pinCenterY = pinRect.top + pinRect.height / 2;
          const screenWidth = Number(stage.dataset.screenWidth);
          const screenHeight = Number(stage.dataset.screenHeight);
          const scale = Math.min(stageRect.width / screenWidth, stageRect.height / screenHeight);
          const imageLeft = stageRect.left + (stageRect.width - screenWidth * scale) / 2;
          const imageTop = stageRect.top + (stageRect.height - screenHeight * scale) / 2;
          return {
            startError: Math.hypot(x1 - cardRect.right, y1 - (cardRect.top + cardRect.height / 2)),
            pinBoundaryError: Math.abs(Math.hypot(x2 - pinCenterX, y2 - pinCenterY) - pinRect.width / 2),
            pinInsideImage:
              pinCenterX >= imageLeft && pinCenterX <= imageLeft + screenWidth * scale &&
              pinCenterY >= imageTop && pinCenterY <= imageTop + screenHeight * scale
          };
        }, step);
        expect(geometry.startError).toBeLessThanOrEqual(2);
        expect(geometry.pinBoundaryError).toBeLessThanOrEqual(2);
        expect(geometry.pinInsideImage).toBe(true);
      }

      if (sheetIndex < SOP_SHEETS.length - 1) {
        await page.getByRole('button', { name: '次の手順' }).click();
      }
    }

    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(frameElement).toHaveCount(0);
  });
}

for (const scenario of ['revise', 'fixed_count'] as const) {
  const viewport =
    scenario === 'revise'
      ? { width: 1280, height: 800 }
      : { width: 1536, height: 864 };

  test(`${scenario} ${viewport.width}x${viewport.height}: 改版プレビューは生成取説を表示して画面状態を維持する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockKioskLayoutApis(page);
    await page.goto(`/dev/kiosk-inspection-drawing-create?scenario=${scenario}`, {
      waitUntil: 'domcontentloaded'
    });

    const testInputButton = page.getByRole('button', { name: 'テスト入力' });
    await testInputButton.click();
    await expect(testInputButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'この画面の操作手順を開く' }).click();
    const frame = page.frameLocator('[data-testid="kiosk-sop-frame"]');
    await expect(frame.locator('.sheet[data-sheet="library-entry-search"]')).toBeHidden();
    await expect(frame.locator('.sheet[data-sheet="edit-basics"]')).toBeVisible();
    await expect(frame.getByText('対象情報を確認')).toBeVisible();
    await expect(frame.getByText('改版を保存')).toBeVisible();

    await page.getByRole('button', { name: '次の手順' }).click();
    await expect(frame.locator('.sheet[data-sheet="edit-required-point"]')).toBeVisible();
    await expect(frame.getByText('直す点を選ぶ')).toBeVisible();

    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(testInputButton).toHaveAttribute('aria-pressed', 'true');
  });
}

test('create_new: 新規作成プレビューには取説を表示しない', async ({ page }) => {
  await mockKioskLayoutApis(page);
  await page.goto('/dev/kiosk-inspection-drawing-create?scenario=create_new', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.getByTestId('inspection-drawing-create-header-band')).toBeVisible();
  await expect(page.getByRole('button', { name: 'この画面の操作手順を開く' })).toHaveCount(0);
});
