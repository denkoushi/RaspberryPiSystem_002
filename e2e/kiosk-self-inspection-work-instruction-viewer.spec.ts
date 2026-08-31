import { expect, test, type Page } from '@playwright/test';

const CLIENT_KEY = 'client-key-kiosk-self-inspection-work-instruction-viewer';
const PART_NUMBER = 'FH-24A-018';
const LONG_MEMO =
  '砥石をワークへ近づける前に、保護カバー、クーラント、回転方向を確認します。初回接触は送り量を抑え、異音や過大な火花がないことを確認してください。途中で異常を感じた場合は直ちに停止し、責任者へ連絡します。カード本文は縦スクロールできます。\n' +
  '加工中はワークの固定状態、冷却液の流れ、周囲の安全を確認し、異常があれば作業を中断して責任者へ連絡します。\n' +
  '加工後は焼け、びびり、傷、寸法の変化を確認し、必要な記録を残してから次工程へ引き渡します。';
const LONG_MEMO_FRAGMENT = '保護カバー、クーラント、回転方向';
const FIRST_IMAGE_MEMO =
  'ワーク外周と端面に打痕・錆・異物がないことを確認します。チャック爪との接触面を清掃してから取り付けてください。';
const IMAGE_ASSET_ID = '00000000-0000-0000-0000-000000000001';
const IMAGE_PATH = `/api/work-instructions/assets/${IMAGE_ASSET_ID}`;

const workInstructionTargets = ['研削', '切削', '581', '582'] as const;

const workInstructionGroups = workInstructionTargets.map((shootingTarget, index) => ({
  partNumber: PART_NUMBER,
  shootingTarget,
  rowCount: 1,
  stepCount: index === 0 ? 8 : 1,
  latestModified: '2026-08-31T00:00:00.000Z'
}));

const stepTexts = [
  '加工前確認',
  '基準面を合わせる',
  '本文のみの手順',
  '長いmemo',
  '画像読込失敗',
  '仕上がり確認',
  '清掃',
  '記録'
] as const;

const workInstructionSteps = stepTexts.map((text, index) => ({
  id: `work-instruction-step-${index + 1}`,
  rowId: 'work-instruction-row-1',
  step: index + 1,
  text: index === 0 ? FIRST_IMAGE_MEMO : index === 3 ? LONG_MEMO : text,
  imageName: index === 2 || index === 4 || index === 7 ? null : `step-${index + 1}.svg`,
  imageAssetId: index === 2 || index === 4 || index === 7 ? null : IMAGE_ASSET_ID,
  imageUrl: index === 2 || index === 4 || index === 7 ? null : IMAGE_PATH,
  imageMimeType: index === 2 || index === 4 || index === 7 ? null : 'image/jpeg',
  imageSha256: index === 2 || index === 4 || index === 7 ? null : 'a'.repeat(64),
  source: {
    system: 'E2E-WorkInstruction',
    list: 'WorkInstructions',
    itemId: index + 1
  }
}));

const workInstructionDetail = {
  partNumber: PART_NUMBER,
  shootingTarget: '研削',
  rows: [
    {
      id: 'work-instruction-row-1',
      source: {
        system: 'E2E-WorkInstruction',
        list: 'WorkInstructions',
        itemId: 1,
        modified: '2026-08-31T00:00:00.000Z'
      },
      partNumber: PART_NUMBER,
      shootingTarget: '研削',
      contentHash: 'b'.repeat(64),
      rawManifest: { schema_version: 1 },
      steps: workInstructionSteps,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z'
    }
  ],
  steps: workInstructionSteps
};

const selfInspectionSession = {
  id: 'work-instruction-viewer-session-1',
  sessionBusinessKey: 'work-instruction-viewer-business-1',
  templateId: 'work-instruction-viewer-template-1',
  templateName: '自主検査 E2E',
  productNo: 'ORDER-WORK-INSTRUCTION-001',
  fseiban: 'SEIBAN-WORK-INSTRUCTION-001',
  fhincd: PART_NUMBER,
  fhinmei: '作業要領 viewer E2E 部品',
  processGroup: 'cutting',
  resourceCd: '581',
  scheduleRowId: 'work-instruction-viewer-schedule-1',
  machineName: '設備 E2E',
  plannedQuantity: 10,
  expectedEntryCount: 10,
  requiredEntryCount: 10,
  completedEntryCount: 0,
  pendingReviewCount: 0,
  participantEmployeeNames: ['E2E作業者'],
  participantEmployees: [],
  selfInspectionMode: 'all',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  status: 'in_progress',
  startedAt: '2026-08-31T00:00:00.000Z',
  completedAt: null,
  recordApprovalRequiredAt: null,
  recordApprovalWorkflowStartedAt: null,
  inspectorRemeasurementRequiredAt: null,
  inspectorMeasurementState: 'not_required',
  inspectorRequiredEntryCount: 0,
  inspectorCompletedRequiredEntryCount: 0,
  inspectorMissingRequiredEntryCount: 0,
  inspectorIncompleteValueEntryCount: 0,
  decisionWorkflow: null,
  updatedAt: '2026-08-31T01:00:00.000Z'
};

const filteredScheduleRow = {
  id: 'work-instruction-viewer-schedule-filtered',
  occurredAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T01:00:00.000Z',
  rowData: {
    ProductNo: 'ORDER-WORK-INSTRUCTION-001',
    FSEIBAN: 'SEIBAN-WORK-INSTRUCTION-001',
    FHINCD: PART_NUMBER,
    FHINMEI: '作業要領 viewer E2E 部品',
    FSIGENCD: '581'
  },
  plannedQuantity: 10,
  resolvedMachineName: '設備 E2E',
  partMeasurementProcessGroup: 'cutting',
  selfInspectionTemplateId: 'work-instruction-viewer-template-1',
  selfInspectionStatus: 'not_started',
  selfInspectionEntryPath:
    '/kiosk/part-measurement/self-inspection/start?templateId=work-instruction-viewer-template-1'
};

type ApiTrace = {
  groupRequests: string[];
  detailRequests: string[];
  assetRequests: string[];
  assetClientKeys: string[];
};

async function installApiMocks(page: Page): Promise<ApiTrace> {
  const trace: ApiTrace = {
    groupRequests: [],
    detailRequests: [],
    assetRequests: [],
    assetClientKeys: []
  };

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
      await route.fulfill({ json: { selfClientId: 'work-instruction-viewer-e2e', targets: [] } });
      return;
    }
    if (path === '/api/part-measurement/self-inspection/sessions') {
      await route.fulfill({
        json: {
          sessions: [selfInspectionSession],
          truncated: false,
          listLimit: 200
        }
      });
      return;
    }
    if (path === '/api/kiosk/production-schedule/resources') {
      await route.fulfill({
        json: {
          resources: ['581', '582'],
          resourceNameMap: {
            '581': ['第一資源'],
            '582': ['第二資源']
          }
        }
      });
      return;
    }
    if (path === '/api/kiosk/production-schedule') {
      await route.fulfill({
        json: { page: 1, pageSize: 50, rows: [filteredScheduleRow], hasMore: false }
      });
      return;
    }
    if (path === '/api/work-instructions/groups') {
      trace.groupRequests.push(url.toString());
      const partNumber = url.searchParams.get('partNumber');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      await route.fulfill({
        json: {
          groups: partNumber === PART_NUMBER && offset === 0 ? workInstructionGroups : [],
          limit: 100,
          offset
        }
      });
      return;
    }
    if (path === '/api/work-instructions/group') {
      trace.detailRequests.push(url.toString());
      const partNumber = url.searchParams.get('partNumber');
      const resource = url.searchParams.get('resource');
      if (partNumber !== PART_NUMBER || resource !== '研削') {
        await route.fulfill({ status: 404, json: { message: 'unexpected work-instruction target' } });
        return;
      }
      await route.fulfill({ json: workInstructionDetail });
      return;
    }
    if (path === IMAGE_PATH) {
      trace.assetRequests.push(url.toString());
      trace.assetClientKeys.push(route.request().headers()['x-client-key'] ?? '');
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#e2e8f0"/><text x="80" y="280" font-size="72">研削</text></svg>'
      });
      return;
    }

    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });

  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);

  return trace;
}

async function openSelfInspection(page: Page): Promise<void> {
  await page.goto('/kiosk/part-measurement/self-inspection', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('仕掛中を読込中…')).toHaveCount(0);
  await expect(page.getByTestId('self-inspection-table-panes')).toBeVisible();
}

async function scanPartNumber(page: Page): Promise<void> {
  const scanButton = page.getByRole('button', { name: '部品番号スキャン', exact: true });
  await scanButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'FHINCD' })).toBeVisible();
  await page.keyboard.type(PART_NUMBER);
  await page.keyboard.press('Enter');
}

async function expectToolbarLayout(page: Page): Promise<void> {
  const toolbar = page.getByRole('heading', { name: '自主検査', exact: true }).locator('..');
  const toolbarMetrics = await toolbar.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(toolbarMetrics.height).toBeCloseTo(60, 0);
  expect(toolbarMetrics.scrollWidth).toBeLessThanOrEqual(toolbarMetrics.clientWidth + 1);

  const partButton = page.getByRole('button', { name: '部品番号スキャン', exact: true });
  const chipStrip = page.getByLabel('撮影対象');
  const toolbarBox = await toolbar.boundingBox();
  const partButtonBox = await partButton.boundingBox();
  const chipStripBox = await chipStrip.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(partButtonBox).not.toBeNull();
  expect(chipStripBox).not.toBeNull();
  if (toolbarBox && partButtonBox && chipStripBox) {
    expect(toolbarBox.x + toolbarBox.width - partButtonBox.x - partButtonBox.width).toBeLessThanOrEqual(12);
    expect(chipStripBox.x + chipStripBox.width).toBeLessThanOrEqual(partButtonBox.x + 1);
  }

  const controlHeights = await toolbar
    .locator('button')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(controlHeights.length).toBeGreaterThan(0);
  expect(controlHeights.every((height) => height >= 44)).toBe(true);
}

async function expectPartScanResult(page: Page, trace: ApiTrace): Promise<void> {
  await expect.poll(() => trace.groupRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(trace.detailRequests).toHaveLength(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const chipStrip = page.getByLabel('撮影対象');
  await expect(chipStrip).toBeVisible();
  await expect(chipStrip.getByRole('button')).toHaveText([...workInstructionTargets]);
  await expect(page.getByRole('heading', { name: '撮影対象', exact: true })).toHaveCount(0);
  await expectToolbarLayout(page);
}

async function openViewerAndAssertCards(page: Page, trace: ApiTrace, columns: number): Promise<void> {
  await page.getByRole('button', { name: '研削', exact: true }).click();
  await expect.poll(() => trace.detailRequests.length, { timeout: 10_000 }).toBe(1);

  const viewer = page.getByRole('dialog', { name: '作業要領書', exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('aria-modal', 'true');

  const cardGrid = viewer.getByTestId('work-instruction-card-grid');
  await expect(cardGrid).toBeVisible();
  await expect(cardGrid.getByRole('article')).toHaveCount(workInstructionSteps.length);

  const computedColumns = await cardGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
  );
  expect(computedColumns).toBe(columns);

  const longCard = cardGrid.getByRole('article').filter({ hasText: LONG_MEMO_FRAGMENT }).first();
  const longMemo = longCard.getByText(LONG_MEMO_FRAGMENT).locator('..');
  await expect(longMemo).toContainText(LONG_MEMO_FRAGMENT);
  const memoMetrics = await longMemo.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY
  }));
  expect(memoMetrics.scrollHeight).toBeGreaterThan(memoMetrics.clientHeight);
  expect(['auto', 'scroll']).toContain(memoMetrics.overflowY);

  const photoButton = viewer.getByRole('button', { name: '手順1の画像を拡大', exact: true });
  await expect(photoButton).toBeVisible();
  expect(await photoButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await photoButton.click();

  const imageDialog = page.getByRole('dialog', { name: '作業要領画像', exact: true });
  await expect(imageDialog).toBeVisible();
  await expect(imageDialog).toHaveAttribute('aria-modal', 'true');
  const imageDialogBox = await imageDialog.boundingBox();
  expect(imageDialogBox).not.toBeNull();
  if (imageDialogBox) {
    expect(imageDialogBox.width).toBeGreaterThan(page.viewportSize()!.width * 0.8);
    expect(imageDialogBox.height).toBeGreaterThan(page.viewportSize()!.height * 0.8);
  }
  await expect(imageDialog.getByRole('img')).toBeVisible();
  await expect.poll(() => trace.assetRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(trace.assetClientKeys).toContain(CLIENT_KEY);

  const enlargedImage = imageDialog.getByRole('img').first();
  const imageMemoLabel = imageDialog.getByText('MEMO', { exact: true });
  await expect(imageMemoLabel).toBeVisible();
  await expect(imageDialog).toContainText('ワーク外周と端面');
  const imageAndMemo = await Promise.all([enlargedImage.boundingBox(), imageMemoLabel.boundingBox()]);
  expect(imageAndMemo[0]).not.toBeNull();
  expect(imageAndMemo[1]).not.toBeNull();
  if (imageAndMemo[0] && imageAndMemo[1]) {
    expect(imageAndMemo[1].y).toBeGreaterThanOrEqual(imageAndMemo[0].y + imageAndMemo[0].height - 1);
  }

  const closeImage = imageDialog.getByRole('button', { name: '画像を閉じる', exact: true });
  await expect(closeImage).toBeVisible();
  expect(await closeImage.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await closeImage.click();
  await expect(imageDialog).toHaveCount(0);
  await expect(viewer).toBeVisible();

  const backButton = viewer.getByRole('button', { name: '自主検査画面に戻る', exact: true });
  await expect(backButton).toBeVisible();
  expect(await backButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await backButton.click();
  await expect(viewer).toHaveCount(0);
}

for (const viewport of [
  { width: 1280, height: 800, columns: 3 },
  { width: 1920, height: 1080, columns: 4 }
] as const) {
  test(`${viewport.width}px: FHINCDから作業要領を選択し、画像popupと一覧復帰を維持する`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const trace = await installApiMocks(page);
    await openSelfInspection(page);

    const productFilter = page.getByRole('combobox', { name: '製造order / 製番 / 品番' });
    const resourceFilter = page.getByRole('combobox', { name: '資源CD' });
    await productFilter.fill('ORDER-WORK-INSTRUCTION-001');
    await resourceFilter.fill('581');

    await scanPartNumber(page);
    await expectPartScanResult(page, trace);
    await openViewerAndAssertCards(page, trace, viewport.columns);

    await expect(page.getByRole('heading', { name: '自主検査', exact: true })).toBeVisible();
    await expect(page.getByTestId('self-inspection-table-panes')).toBeVisible();
    await expect(page.getByLabel('撮影対象')).toBeVisible();
    await expect(page.getByRole('button', { name: '研削', exact: true })).toBeVisible();
    await expect(productFilter).toHaveValue('ORDER-WORK-INSTRUCTION-001');
    await expect(resourceFilter).toHaveValue('581');
    expect(trace.groupRequests).toHaveLength(1);
    expect(trace.detailRequests).toHaveLength(1);
  });
}
