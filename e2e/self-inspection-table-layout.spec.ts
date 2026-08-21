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

const candidateRow = {
  id: 'candidate-schedule-row-1',
  occurredAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T01:02:03.000Z',
  rowData: {
    ProductNo: 'ORDER-CANDIDATE-001',
    FSEIBAN: 'SEIBAN-CANDIDATE-001',
    FHINCD: 'PART-CANDIDATE-001',
    FHINMEI: '候補行の長い品名を一行省略で確認する部品',
    FSIGENCD: 'R-1'
  },
  plannedQuantity: 12,
  resolvedMachineName: '候補ＡＰＩ正本から解決した機種名',
  partMeasurementProcessGroup: 'cutting',
  selfInspectionTemplateId: 'candidate-template-1',
  selfInspectionStatus: 'not_started',
  selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/start?templateId=candidate-template-1'
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
  Object.assign(inProgress[0]!, {
    fseiban: 'SEIBAN-VERY-LONG-IDENTITY-0001',
    machineName: '設備ＡＢＣ１２３名称が非常に長い場合のトランケート確認用',
    fhinmei: '品名が非常に長い場合でも1行に収まることの確認用部品',
    participantEmployeeNames: ['担当者の表示名が長い場合の確認用']
  });
  Object.assign(reviewPending[0]!, {
    completedEntryCount: reviewPending[0]!.requiredEntryCount,
    inspectorRemeasurementRequiredAt: '2026-07-14T01:00:00.000Z',
    inspectorMeasurementState: 'complete',
    decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT'
  });

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
      await route.fulfill({
        json: {
          resources: ['R-1', 'R-2', 'R-3', 'R-4'],
          resourceNameMap: {
            'R-1': ['第一資源の日本語表示名'],
            'R-2': ['第二資源の日本語表示名'],
            'R-3': ['第三資源の日本語表示名'],
            'R-4': ['第四資源の日本語表示名']
          }
        }
      });
      return;
    }
    if (path === '/api/kiosk/production-schedule') {
      await route.fulfill({
        json: { page: 1, pageSize: 50, rows: [candidateRow], hasMore: false }
      });
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
    { width: 1280, height: 760, panes: 1 },
    { width: 1536, height: 864, panes: 2 },
    { width: 1920, height: 1080, panes: 2 }
  ]) {
    test(`${viewport.width}x${viewport.height} で ${viewport.panes} ペインと2行アイテムを維持する`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openSelfInspection(page);

      const panes = page.getByTestId('self-inspection-table-panes');
      await expect(panes).toHaveAttribute('data-pane-count', String(viewport.panes));
      await expect(panes.locator('table')).toHaveCount(viewport.panes);
      await expect(panes.locator('caption')).toHaveCount(viewport.panes);
      await expect(panes.locator('thead.sr-only')).toHaveCount(viewport.panes);
      await expect(panes.locator('thead th')).toHaveCount(viewport.panes * 4);

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
      await expect(page.getByRole('button', { name: '記録確認・承認' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: '製造order / 製番 / 品番' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: '資源CD' })).toBeVisible();

      const controlHeights = await header
        .locator('button, input')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(controlHeights.every((height) => height >= 44)).toBe(true);

      const productNos = (await panes.getByTestId('self-inspection-item-metadata').allTextContents())
        .map((text) => text.match(/製造order\s+([^/]+)/)?.[1]?.trim());
      expect(productNos).toEqual(Array.from({ length: 12 }, (_, index) => `ORDER-${String(index + 1).padStart(2, '0')}`));

      const firstMetadataPrimary = panes.getByTestId('self-inspection-item-metadata-primary').first();
      const firstMetadataSecondary = panes.getByTestId('self-inspection-item-metadata-secondary').first();
      await expect(firstMetadataPrimary).toContainText(
        'R-1 / 第一資源の日本語表示名'
      );
      await expect(firstMetadataSecondary).toContainText('更新 2026/07/15(水) 08:00');
      await expect(firstMetadataSecondary).not.toContainText(/08:00:\d{2}/);
      await expect(panes.getByTestId('self-inspection-item-state').filter({ hasText: '入力中' })).toHaveCount(8);
      await expect(panes.getByTestId('self-inspection-item-state').filter({ hasText: '最終判定待ち' })).toHaveCount(1);

      const firstIdentity = panes.getByTestId('self-inspection-item-primary-row').first();
      await expect(firstIdentity.getByTestId('self-inspection-item-identity-fseiban')).toHaveAttribute(
        'title',
        'SEIBAN-VERY-LONG-IDENTITY-0001'
      );
      await expect(firstIdentity.getByTestId('self-inspection-item-identity-machine-name')).toHaveAttribute(
        'title',
        '設備ABC123名称が非常に長い場合のトランケート確認用'
      );
      await expect(firstIdentity.getByTestId('self-inspection-item-identity-fhinmei')).toHaveAttribute(
        'title',
        '品名が非常に長い場合でも1行に収まることの確認用部品'
      );

      const itemMetrics = await firstIdentity.evaluate((element) => {
        const secondary = element.nextElementSibling;
        const identity = element.querySelector('[data-testid="self-inspection-item-identity"]');
        const identityValues = Array.from(element.querySelectorAll('[data-testid^="self-inspection-item-identity-"]'));
        const fseiban = element.querySelector('[data-testid="self-inspection-item-identity-fseiban"]');
        const machineName = element.querySelector('[data-testid="self-inspection-item-identity-machine-name"]');
        const productName = element.querySelector('[data-testid="self-inspection-item-identity-fhinmei"]');
        const state = element.querySelector('[data-testid="self-inspection-item-state"]');
        const secondaryGrid = secondary?.querySelector('div.grid');
        const secondaryCell = secondary?.querySelector('td');
        const metadataLines = Array.from(secondary?.querySelectorAll('[data-testid^="self-inspection-item-metadata-"]') ?? []);
        const primaryRect = element.getBoundingClientRect();
        const secondaryRect = secondary?.getBoundingClientRect();
        const gridRect = secondaryGrid?.getBoundingClientRect();
        const identityRect = identity?.getBoundingClientRect();
        const fseibanRect = fseiban?.getBoundingClientRect();
        const machineNameRect = machineName?.getBoundingClientRect();
        const productNameRect = productName?.getBoundingClientRect();
        const stateRect = state?.getBoundingClientRect();
        return {
          primaryHeight: primaryRect.height,
          secondaryHeight: secondaryRect?.height ?? 0,
          itemHeight: (secondaryRect?.bottom ?? primaryRect.bottom) - primaryRect.top,
          primaryCellHeight: element.querySelector('td')?.getBoundingClientRect().height ?? 0,
          secondaryCellHeight: secondaryCell?.getBoundingClientRect().height ?? 0,
          identityGridTemplateColumns: identity ? getComputedStyle(identity).gridTemplateColumns : '',
          identityFontSizes: identityValues.map((value) => getComputedStyle(value).fontSize),
          identityColors: identityValues.map((value) => getComputedStyle(value).color),
          identityWhiteSpaces: identityValues.map((value) => getComputedStyle(value).whiteSpace),
          fseibanMachineGap: (machineNameRect?.left ?? 0) - (fseibanRect?.right ?? 0),
          identityColumnGap: identity ? Number.parseFloat(getComputedStyle(identity).columnGap) : 0,
          productStateOverlap: Math.max(0, (productNameRect?.right ?? 0) - (stateRect?.left ?? 0)),
          stateRightGap: (identityRect?.right ?? 0) - (stateRect?.right ?? 0),
          secondaryGridTemplateColumns: secondaryGrid ? getComputedStyle(secondaryGrid).gridTemplateColumns : '',
          secondaryColumnWidths: gridRect && secondaryGrid
            ? Array.from(secondaryGrid.children).map((child) => child.getBoundingClientRect().width / gridRect.width)
            : [],
          metadataColors: metadataLines.map((line) => getComputedStyle(line).color),
          bodyRowCount: element.closest('table')?.querySelectorAll('tbody tr').length ?? 0
        };
      });
      expect(Math.abs(itemMetrics.primaryHeight - 43.3)).toBeLessThanOrEqual(1);
      expect(Math.abs(itemMetrics.secondaryHeight - 51)).toBeLessThanOrEqual(1);
      expect(Math.abs(itemMetrics.itemHeight - 94.3)).toBeLessThanOrEqual(1);
      expect(Math.abs(itemMetrics.primaryCellHeight - 43.3)).toBeLessThanOrEqual(1);
      expect(Math.abs(itemMetrics.secondaryCellHeight - 51)).toBeLessThanOrEqual(1);
      expect(itemMetrics.identityGridTemplateColumns.split(' ').length).toBe(4);
      expect(itemMetrics.identityFontSizes).toEqual(['21px', '15.75px', '21px']);
      expect(itemMetrics.identityColors.every((color) => color === 'rgb(255, 255, 255)')).toBe(true);
      expect(itemMetrics.identityWhiteSpaces.every((whiteSpace) => whiteSpace === 'nowrap')).toBe(true);
      expect(itemMetrics.fseibanMachineGap).toBeCloseTo(itemMetrics.identityColumnGap, 1);
      expect(itemMetrics.productStateOverlap).toBe(0);
      expect(Math.abs(itemMetrics.stateRightGap)).toBeLessThanOrEqual(1);
      expect(itemMetrics.secondaryGridTemplateColumns.split(' ').length).toBe(2);
      expect(itemMetrics.secondaryColumnWidths[0]).toBeCloseTo(0.62, 1);
      expect(itemMetrics.secondaryColumnWidths[1]).toBeCloseTo(0.38, 1);
      expect(itemMetrics.metadataColors.every((color) => color === 'rgb(255, 255, 255)')).toBe(true);
      expect(itemMetrics.bodyRowCount % 2).toBe(0);

      const actionPrimaryCounts = await panes.getByTestId('self-inspection-row-actions').evaluateAll((groups) =>
        groups.map((group) => ({
          primaryCount: Array.from(group.querySelectorAll('button, a')).filter((action) =>
            action.className.includes('bg-emerald-500')
          ).length,
          dangerCount: group.querySelectorAll('button[title="削除"]').length
        }))
      );
      expect(actionPrimaryCounts.every(({ primaryCount }) => primaryCount <= 1)).toBe(true);
      expect(actionPrimaryCounts.every(({ dangerCount }) => dangerCount === 1)).toBe(true);

      const paneOverflow = await panes.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }));
      expect(paneOverflow.scrollWidth).toBeLessThanOrEqual(paneOverflow.clientWidth + 1);
      const rowActionMetrics = await panes
        .getByTestId('self-inspection-row-actions')
        .first()
        .evaluate((element) => ({
          display: getComputedStyle(element).display,
          flexWrap: getComputedStyle(element).flexWrap,
          buttonHeights: Array.from(element.querySelectorAll('button, a')).map(
            (action) => action.getBoundingClientRect().height
          ),
          fontSizes: Array.from(element.querySelectorAll('button, a')).map(
            (action) => getComputedStyle(action).fontSize
          )
        }));
      expect(rowActionMetrics.display).toBe('flex');
      expect(rowActionMetrics.flexWrap).toBe('wrap');
      expect(rowActionMetrics.buttonHeights.every((height) => Math.abs(height - 30.8) <= 1)).toBe(true);
      expect(rowActionMetrics.fontSizes.every((fontSize) => fontSize === '14px')).toBe(true);

      const screenshotDir = process.env.SELF_INSPECTION_E2E_SCREENSHOT_DIR?.replace(/\/$/, '');
      if (screenshotDir) {
        await page.screenshot({
          path: `${screenshotDir}/self-inspection-session-${viewport.width}x${viewport.height}.png`,
          fullPage: true
        });
      }

      const productSearch = page.getByRole('combobox', { name: '製造order / 製番 / 品番' });
      await productSearch.fill('ORDER-CANDIDATE-001');
      const candidateMachineName = panes.getByTestId('self-inspection-item-identity-machine-name');
      await expect(candidateMachineName).toHaveAttribute('title', '候補API正本から解決した機種名');
      await productSearch.press('Escape');
      await expect(panes.getByTestId('self-inspection-item-metadata-primary')).toContainText(
        '製造order ORDER-CANDIDATE-001 / R-1 / 第一資源の日本語表示名'
      );
      await expect(panes.getByTestId('self-inspection-item-metadata-secondary')).toContainText(
        '更新 2026/07/14(火) 10:02'
      );
      const candidateItemHeight = await panes
        .getByTestId('self-inspection-item-primary-row')
        .evaluate((element) => {
          const secondary = element.nextElementSibling;
          return (secondary?.getBoundingClientRect().bottom ?? element.getBoundingClientRect().bottom)
            - element.getBoundingClientRect().top;
        });
      expect(Math.abs(candidateItemHeight - 94.3)).toBeLessThanOrEqual(1);
      if (screenshotDir) {
        await page.screenshot({
          path: `${screenshotDir}/self-inspection-candidate-${viewport.width}x${viewport.height}.png`,
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
  await expect(page.getByTestId('inspection-template-frequency')).toHaveText('頻度: 全数');
  const frequencyImmediatelyBeforeActions = await page
    .getByTestId('inspection-template-frequency')
    .evaluate((element) => element.nextElementSibling?.hasAttribute('data-testid') === true &&
      element.nextElementSibling?.getAttribute('data-testid') === 'inspection-template-secondary-actions');
  expect(frequencyImmediatelyBeforeActions).toBe(true);

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
