import { expect, test, type Locator, type Page } from '@playwright/test';

const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
] as const;

async function mockKioskApis(page: Page, deployNotice = false): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/src/api/')) {
      await route.continue();
      return;
    }
    if (path.includes('/system/deploy-status/ack')) {
      await route.fulfill({
        json: {
          acknowledged: true,
          scheduledAt: new Date(Date.now() + 60_000).toISOString()
        }
      });
      return;
    }
    if (path.includes('/system/deploy-status')) {
      await route.fulfill({
        json: deployNotice
          ? {
              isMaintenance: false,
              runId: 'assembly-ui-e2e',
              preNotice: { scheduledAt: new Date(Date.now() + 60_000).toISOString() }
            }
          : { isMaintenance: false }
      });
      return;
    }
    if (path.includes('/kiosk/config')) {
      await route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
      return;
    }
    if (path.includes('/kiosk/call/targets')) {
      await route.fulfill({ json: { selfClientId: 'assembly-ui-e2e', targets: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

async function calloutLineGeometry(line: Locator) {
  return line.evaluate((element) => ({
    x1: Number(element.getAttribute('x1')),
    y1: Number(element.getAttribute('y1')),
    x2: Number(element.getAttribute('x2')),
    y2: Number(element.getAttribute('y2'))
  }));
}

async function expectCssPixelCalloutLayout(page: Page) {
  const svg = page.getByTestId('image-marker-callout-svg');
  await expect(svg).toBeVisible();
  const metrics = await svg.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewBox = (element as SVGSVGElement).viewBox.baseVal;
    return {
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      viewBoxWidth: viewBox.width,
      viewBoxHeight: viewBox.height
    };
  });
  expect(metrics.viewBoxWidth).toBeGreaterThan(100);
  expect(metrics.viewBoxHeight).toBeGreaterThan(100);
  expect(Math.abs(metrics.renderedWidth - metrics.viewBoxWidth)).toBeLessThan(1);
  expect(Math.abs(metrics.renderedHeight - metrics.viewBoxHeight)).toBeLessThan(1);
  await expect(svg.locator('marker').first()).toHaveAttribute('markerWidth', '6');
  await expect(svg.locator('marker').first()).toHaveAttribute('markerHeight', '6');
}

async function expectNoSettingsPaneOverflow(locator: Locator) {
  const metrics = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
}

async function expectAllControlsInsidePane(locator: Locator) {
  const clippedControls = await locator.evaluate((element) => {
    const paneRect = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('button, input, select'))
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < paneRect.left - 1
          || rect.right > paneRect.right + 1
          || rect.top < paneRect.top - 1
          || rect.bottom > paneRect.bottom + 1;
      })
      .map((control) => control.getAttribute('aria-label') || control.closest('label')?.textContent?.trim() || control.textContent?.trim() || control.tagName);
  });
  expect(clippedControls).toEqual([]);
}

async function expectDirectChildrenOnOneRow(locator: Locator) {
  const metrics = await locator.evaluate((element) => {
    const centers = Array.from(element.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    return {
      centers,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(Math.max(...metrics.centers) - Math.min(...metrics.centers)).toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  test(`assembly library is two-row and deploy notice stays movable/non-blocking at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockKioskApis(page, true);
    await page.goto('/dev/kiosk-assembly-library', { waitUntil: 'networkidle' });

    const procedureTable = page.getByRole('table', { name: '手順書ライブラリ' });
    await expect(procedureTable).toBeVisible();
    await expect(procedureTable.locator('tbody tr')).toHaveCount(4);
    await expect(page.locator('th', { hasText: '型番' }).first()).toBeVisible();

    const combo = page.getByRole('combobox', { name: '手順書名で検索' });
    await combo.click();
    await page.getByRole('option', { name: 'CSPBTLD ストッパー取付 手順書' }).click();
    await expect(combo).toHaveValue('CSPBTLD ストッパー取付 手順書');

    const notice = page.getByTestId('kiosk-deploy-pre-notice');
    await expect(notice).toBeVisible();
    const beforeTransform = await notice.evaluate((element) => (element as HTMLElement).style.transform);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => notice.evaluate((element) => (element as HTMLElement).style.transform))
      .not.toBe(beforeTransform);

    await page.getByRole('button', { name: '登録' }).click();
    await expect(page.getByRole('dialog', { name: '手順書を登録' })).toBeVisible();
  });

  test(`assembly editor zooms, fits, places markers, and renders bolt/check callouts at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockKioskApis(page);
    await page.goto('/dev/kiosk-assembly-template-editor', { waitUntil: 'networkidle' });

    const canvas = page.getByTestId('assembly-procedure-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('svg line')).toHaveCount(2);
    await expect(canvas.locator('button[title^="P7-A13"]')).toHaveCount(2);
    await expectCssPixelCalloutLayout(page);

    const image = canvas.locator('img').last();
    const initialImageBox = await image.boundingBox();
    expect(initialImageBox).not.toBeNull();
    const boltLine = canvas.locator('svg line').nth(0);
    const boltLineBefore = await calloutLineGeometry(boltLine);
    const boltMarker = canvas.getByRole('button', { name: 'P7-A13-U1-B1' });
    const boltMarkerBefore = await boltMarker.boundingBox();
    expect(boltMarkerBefore).not.toBeNull();
    await page
      .getByRole('group', { name: '締結マーカーの位置調整' })
      .getByRole('button', { name: '右へ移動' })
      .click();
    const boltMarkerAfter = await boltMarker.boundingBox();
    expect(boltMarkerAfter).not.toBeNull();
    expect(boltMarkerAfter!.x - boltMarkerBefore!.x).toBeCloseTo(initialImageBox!.width * 0.0025, 1);
    const boltLineAfter = await calloutLineGeometry(boltLine);
    expect(boltLineAfter.x1 - boltLineBefore.x1).toBeCloseTo(initialImageBox!.width * 0.0025, 1);
    expect(boltLineAfter.y1).toBe(boltLineBefore.y1);
    expect(boltLineAfter.x2).toBe(boltLineBefore.x2);
    expect(boltLineAfter.y2).toBe(boltLineBefore.y2);

    await canvas.getByRole('button', { name: '目視確認' }).click();
    const checkLine = canvas.locator('svg line').nth(1);
    const checkLineBefore = await calloutLineGeometry(checkLine);
    await page
      .getByRole('group', { name: 'チェックマーカーの位置調整' })
      .getByRole('button', { name: '上へ移動' })
      .click();
    const checkLineAfter = await calloutLineGeometry(checkLine);
    expect(checkLineAfter.x1).toBe(checkLineBefore.x1);
    expect(checkLineBefore.y1 - checkLineAfter.y1).toBeCloseTo(initialImageBox!.height * 0.0025, 1);
    expect(checkLineAfter.x2).toBe(checkLineBefore.x2);
    expect(checkLineAfter.y2).toBe(checkLineBefore.y2);

    for (let index = 0; index < 6; index += 1) {
      await page.getByRole('button', { name: '拡大' }).click();
    }
    await expect.poll(() => canvas.evaluate((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight))
      .toBe(true);
    await expectCssPixelCalloutLayout(page);

    await page.getByRole('button', { name: '全面表示' }).click();
    await expect.poll(() => canvas.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })))
      .toEqual({ left: 0, top: 0 });

    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    await page.getByRole('button', { name: '締結マーカー' }).click();
    await page.mouse.click(box!.x + box!.width * 0.88, box!.y + box!.height * 0.86);
    await expect(canvas.locator('button[title^="P7-A13"]')).toHaveCount(3);

    await page.getByRole('button', { name: '作業画面表示' }).click();
    const workImage = page.getByTestId('assembly-procedure-image-with-markers');
    await expect(workImage).toBeVisible();
    await expect(workImage.locator('svg line')).toHaveCount(2);
    await expect(workImage.locator('button[title^="P7-A13"]')).toHaveCount(3);
    await expectCssPixelCalloutLayout(page);
    await expect(page.getByRole('group', { name: '締結マーカーの位置調整' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'チェックマーカーの位置調整' })).toHaveCount(0);
  });

  test(`assembly editor keeps its toolbar on one row and all settings visible without scrolling at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockKioskApis(page);
    await page.goto('/dev/kiosk-assembly-template-editor', { waitUntil: 'networkidle' });

    const toolbar = page.getByTestId('assembly-editor-toolbar');
    const settingsPane = page.getByTestId('assembly-editor-settings-pane');
    await expect(toolbar).toBeVisible();
    await expect(settingsPane).toBeVisible();
    await expectDirectChildrenOnOneRow(toolbar);
    await expectNoSettingsPaneOverflow(settingsPane);
    await expectAllControlsInsidePane(settingsPane);
    await expect(settingsPane.getByTestId('assembly-editor-bolt-fields')).toBeVisible();

    const canvas = page.getByTestId('assembly-procedure-canvas');
    await expect(canvas.locator('button[title^="P7-A13"]')).toHaveCount(2);
    await settingsPane.getByRole('button', { name: '削除', exact: true }).click();
    await expect(canvas.locator('button[title^="P7-A13"]')).toHaveCount(1);
    await expect(settingsPane.getByText('手順書上の締結マーカーを選択')).toBeVisible();

    await canvas.getByRole('button', { name: '目視確認' }).click();
    await expect(settingsPane.getByText('チェック 1')).toBeVisible();
    await expectNoSettingsPaneOverflow(settingsPane);
    await expectAllControlsInsidePane(settingsPane);
  });
}
