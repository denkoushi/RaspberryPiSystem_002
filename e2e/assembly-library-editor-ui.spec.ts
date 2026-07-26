import { expect, test, type Locator, type Page } from '@playwright/test';

const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
] as const;

const procedureImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"%3E%3Crect width="1200" height="800" fill="%23f8fafc"/%3E%3Cpath d="M100 400h1000M600 100v600" stroke="%2364758b" stroke-width="8"/%3E%3C/svg%3E';

const unifiedEditorDocuments = [
  {
    id: 'procedure-primary',
    name: '統合エディター 主手順書',
    imageRelativePath: procedureImage,
    status: 'published',
    publishedAt: '2026-07-26T00:00:00.000Z',
    isActive: true,
    pages: [{ pageIndex: 0, imageRelativePath: procedureImage }],
    activeTemplateCount: 0,
    totalTemplateCount: 0,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  },
  {
    id: 'procedure-secondary',
    name: '統合エディター 補助手順書',
    imageRelativePath: procedureImage,
    status: 'published',
    publishedAt: '2026-07-26T00:00:00.000Z',
    isActive: true,
    pages: [{ pageIndex: 0, imageRelativePath: procedureImage }],
    activeTemplateCount: 0,
    totalTemplateCount: 0,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }
] as const;

type AssemblyEditorEvidence = {
  templateBodies: Array<Record<string, unknown>>;
};

async function mockKioskApis(
  page: Page,
  deployNotice = false,
  editorEvidence?: AssemblyEditorEvidence,
  procedureDocuments: ReadonlyArray<Record<string, unknown>> = unifiedEditorDocuments
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
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
    if (path.includes('/assembly/procedure-documents/summary')) {
      await route.fulfill({ json: { documents: procedureDocuments } });
      return;
    }
    if (path.includes('/kiosk/assembly/templates/verify-access-password')) {
      await route.fulfill({ json: { success: true } });
      return;
    }
    if (path.includes('/assembly/templates/summary')) {
      await route.fulfill({ json: { templates: [] } });
      return;
    }
    if (path === '/api/assembly/templates' && request.method() === 'POST') {
      editorEvidence?.templateBodies.push(
        request.postDataJSON() as Record<string, unknown>
      );
      await route.fulfill({ json: { template: { id: 'saved-storyboard-template' } } });
      return;
    }
    if (path.includes('/assembly/library/filter-options')) {
      await route.fulfill({ json: { options: [] } });
      return;
    }
    if (path.includes('/torque-wrench-capability-groups/compatible')) {
      await route.fulfill({ json: { capabilityGroups: [] } });
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
  test(`unified assembly editor maximizes one document and preserves usable canvas with all panes at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const pageErrors: string[] = [];
    const navigationUrls: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigationUrls.push(frame.url());
    });
    await page.setViewportSize(viewport);
    await mockKioskApis(page);
    await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary', {
      waitUntil: 'networkidle'
    });

    await page.getByPlaceholder('パスワード').fill('2520');
    await page.getByRole('button', { name: '認証' }).click();

    const workspace = page.getByTestId('assembly-unified-editor-workspace');
    const canvasPane = page.getByTestId('assembly-unified-editor-canvas-pane');
    const toolbar = page.getByTestId('assembly-editor-toolbar');
    await expect(workspace).toBeVisible();
    await expect(canvasPane).toBeVisible();
    await expect(page.locator('#assembly-procedure-pane')).toHaveCount(0);
    await expectDirectChildrenOnOneRow(toolbar);

    const oneDocumentRatio = await workspace.evaluate((element) => {
      const canvas = element.querySelector<HTMLElement>('[data-testid="assembly-unified-editor-canvas-pane"]');
      return canvas ? canvas.getBoundingClientRect().width / element.getBoundingClientRect().width : 0;
    });
    expect(oneDocumentRatio).toBeGreaterThanOrEqual(0.75);

    await page.getByRole('button', { name: '文書/工程 (1)' }).click();
    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
    await page.getByRole('button', { name: '文書追加' }).click();
    const dialog = page.getByRole('dialog', { name: '文書ライブラリ' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('listitem')
      .filter({ hasText: '統合エディター 補助手順書' })
      .getByLabel('追加', { exact: true })
      .click();
    await expect(page.locator('#assembly-procedure-pane')).toContainText('統合エディター 補助手順書');

    const canvas = page.getByTestId('assembly-procedure-canvas');
    await expect(canvas.locator('img')).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.click(
      canvasBox!.x + canvasBox!.width * 0.5,
      canvasBox!.y + canvasBox!.height * 0.5
    );
    await expect(page.getByTestId('assembly-editor-settings-pane')).toBeVisible();
    await expect(page).toHaveURL(/\/kiosk\/assembly\/templates\/new/);
    await expect(
      toolbar,
      [...pageErrors, `navigations: ${navigationUrls.join(' -> ')}`].join('\n')
    ).toBeAttached();
    await expectDirectChildrenOnOneRow(toolbar);

    const allPanesRatio = await workspace.evaluate((element) => {
      const canvas = element.querySelector<HTMLElement>('[data-testid="assembly-unified-editor-canvas-pane"]');
      return canvas ? canvas.getBoundingClientRect().width / element.getBoundingClientRect().width : 0;
    });
    expect(allPanesRatio).toBeGreaterThanOrEqual(0.55);
    expect(pageErrors).toEqual([]);
  });

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

test('unified assembly editor stacks panels and keeps touch targets usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await mockKioskApis(page);
  await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary', {
    waitUntil: 'networkidle'
  });

  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  await page.getByRole('button', { name: '文書/工程 (1)' }).click();

  const workspace = page.getByTestId('assembly-unified-editor-workspace');
  const procedurePane = page.locator('#assembly-procedure-pane');
  const canvasPane = page.getByTestId('assembly-unified-editor-canvas-pane');
  await expect(procedurePane).toBeVisible();
  await expect(canvasPane).toBeVisible();

  const layout = await workspace.evaluate((element) => {
    const procedure = element
      .querySelector<HTMLElement>('#assembly-procedure-pane')
      ?.closest<HTMLElement>('aside');
    const canvas = element.querySelector<HTMLElement>(
      '[data-testid="assembly-unified-editor-canvas-pane"]'
    );
    if (!procedure || !canvas) return null;
    const workspaceRect = element.getBoundingClientRect();
    const procedureRect = procedure.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      procedureTop: procedureRect.top,
      procedureBottom: procedureRect.bottom,
      canvasTop: canvasRect.top,
      procedureWidthRatio: procedureRect.width / workspaceRect.width,
      canvasWidthRatio: canvasRect.width / workspaceRect.width
    };
  });
  expect(layout).not.toBeNull();
  expect(layout!.canvasTop).toBeGreaterThanOrEqual(layout!.procedureBottom - 1);
  expect(layout!.procedureWidthRatio).toBeGreaterThanOrEqual(0.95);
  expect(layout!.canvasWidthRatio).toBeGreaterThanOrEqual(0.95);

  for (const buttonName of ['文書追加', '前頁', '次頁', '保存']) {
    const button = page.getByRole('button', { name: buttonName, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  }
});

test('assembly storyboard creates, edits, reuses, reorders and saves crop steps', async ({
  page
}) => {
  const evidence: AssemblyEditorEvidence = { templateBodies: [] };
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockKioskApis(page, false, evidence);
  await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary', {
    waitUntil: 'networkidle'
  });
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  await page.getByRole('button', { name: '文書/工程 (1)' }).click();

  const storyboard = page.getByTestId('assembly-step-storyboard');
  await expect(storyboard.locator('article')).toHaveCount(1);
  await page.getByRole('button', { name: '文書・工程', exact: true }).click();
  await page.getByRole('button', { name: '文書追加' }).click();
  await page
    .getByRole('dialog', { name: '文書ライブラリ' })
    .getByRole('listitem')
    .filter({ hasText: '統合エディター 補助手順書' })
    .getByLabel('追加', { exact: true })
    .click();
  await page.getByRole('button', { name: '手順', exact: true }).click();
  await expect(storyboard.locator('article')).toHaveCount(2);

  await page.getByRole('button', { name: '矩形追加', exact: true }).click();
  const canvas = page.getByTestId('assembly-procedure-canvas');
  const sourceImage = canvas.locator('img').last();
  await expect(sourceImage).toBeVisible();
  const imageBox = await sourceImage.boundingBox();
  expect(imageBox).not.toBeNull();
  await page.mouse.move(
    imageBox!.x + imageBox!.width * 0.2,
    imageBox!.y + imageBox!.height * 0.25
  );
  await page.mouse.down();
  await page.mouse.move(
    imageBox!.x + imageBox!.width * 0.8,
    imageBox!.y + imageBox!.height * 0.75
  );
  await page.mouse.up();

  await expect(
    page
      .getByTestId('assembly-unified-editor-canvas-pane')
      .getByTestId('assembly-procedure-crop-view')
  ).toBeVisible();
  await expect(page.getByTestId('assembly-procedure-crop-minimap')).toBeVisible();
  await page.getByLabel('タイトル').fill('重点締付');
  await page.getByLabel('指示文').fill('赤線の内側を先に締める');
  await page.getByRole('button', { name: '⚠ 注意' }).click();
  await expect(storyboard.locator('article')).toHaveCount(3);

  const selectedCropCard = storyboard
    .locator('article')
    .filter({ hasText: '重点締付' });
  await selectedCropCard.getByRole('button', { name: '複製' }).click();
  await expect(storyboard.locator('article')).toHaveCount(4);
  const moveTarget = page.getByLabel('手順4の移動先');
  await moveTarget.fill('2');
  await moveTarget.press('Tab');

  await page.getByLabel('手順検索').fill('重点締付');
  await expect(storyboard.locator('article')).toHaveCount(2);
  await page.getByLabel('手順検索').fill('');

  const workspace = page.getByTestId('assembly-unified-editor-workspace');
  const centralRatio = await workspace.evaluate((element) => {
    const canvasPane = element.querySelector<HTMLElement>(
      '[data-testid="assembly-unified-editor-canvas-pane"]'
    );
    return canvasPane
      ? canvasPane.getBoundingClientRect().width / element.getBoundingClientRect().width
      : 0;
  });
  expect(centralRatio).toBeGreaterThanOrEqual(0.55);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => evidence.templateBodies.length).toBe(1);
  const payload = evidence.templateBodies[0] as {
    procedureDocumentId: string;
    procedureItems: Array<{ assemblyProcedureDocumentId: string | null }>;
    procedureSteps: Array<{
      assemblyProcedureDocumentId: string | null;
      viewMode: string;
      cropXRatio: number | null;
      cropYRatio: number | null;
      cropWidthRatio: number | null;
      cropHeightRatio: number | null;
      title: string | null;
      instructionText: string | null;
      emphasis: string;
    }>;
  };
  expect(payload.procedureDocumentId).toBe('procedure-primary');
  expect(payload.procedureItems.map((item) => item.assemblyProcedureDocumentId)).toEqual([
    'procedure-primary',
    'procedure-secondary'
  ]);
  expect(payload.procedureSteps).toHaveLength(4);
  const cropSteps = payload.procedureSteps.filter((step) => step.viewMode === 'crop');
  expect(cropSteps).toHaveLength(2);
  expect(cropSteps[0]).toMatchObject({
    assemblyProcedureDocumentId: 'procedure-primary',
    title: '重点締付',
    instructionText: '赤線の内側を先に締める',
    emphasis: 'caution'
  });
  expect(cropSteps[0]!.cropXRatio).toBeCloseTo(0.2, 1);
  expect(cropSteps[0]!.cropYRatio).toBeCloseTo(0.25, 1);
  expect(cropSteps[0]!.cropWidthRatio).toBeCloseTo(0.6, 1);
  expect(cropSteps[0]!.cropHeightRatio).toBeCloseTo(0.5, 1);
});

test('assembly storyboard keeps at most 30 DOM cards for 300 steps', async ({ page }) => {
  const largeDocument = {
    ...unifiedEditorDocuments[0],
    id: 'procedure-300-pages',
    name: '300ページ手順書',
    pages: Array.from({ length: 300 }, (_, pageIndex) => ({
      pageIndex,
      imageRelativePath: procedureImage
    }))
  };
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockKioskApis(page, false, undefined, [largeDocument]);
  await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-300-pages', {
    waitUntil: 'networkidle'
  });
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  await page.getByRole('button', { name: '文書/工程 (1)' }).click();
  await expect(page.getByText('手順 300/300')).toBeVisible();
  const domCardCount = await page
    .getByTestId('assembly-step-storyboard')
    .locator('article')
    .count();
  expect(domCardCount).toBeGreaterThan(0);
  expect(domCardCount).toBeLessThanOrEqual(30);
});

test('legacy procedure-order URL redirects to the filtered template library', async ({ page }) => {
  await mockKioskApis(page);
  await page.goto('/kiosk/assembly/procedure-order-settings?machineName=MH-AX');
  await expect(page).toHaveURL(/\/kiosk\/assembly\/library\?focus=templates&modelCode=MH-AX$/);
});
