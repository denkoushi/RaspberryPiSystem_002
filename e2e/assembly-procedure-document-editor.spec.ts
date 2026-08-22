import { expect, test, type Page } from '@playwright/test';

const SOURCE_DOCUMENT_ID = 'assembly-procedure-published-source';
const REVISION_DOCUMENT_ID = 'assembly-procedure-published-source-revision';
const READONLY_SEQUENCE_SESSION_ID = 'assembly-readonly-sequence-session';
const EDITOR_PASSWORD = '2520';
const NOW = '2026-08-21T00:00:00.000Z';

test.describe.configure({ timeout: 60_000 });

const procedureImage = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#f8fafc"/>
    <rect x="80" y="80" width="1040" height="640" fill="#fff" stroke="#334155" stroke-width="8"/>
    <path d="M160 400h880M600 160v480" stroke="#94a3b8" stroke-width="8"/>
    <text x="160" y="220" font-size="48" font-family="sans-serif" fill="#0f172a">組立手順書</text>
  </svg>
`)}`;

const roiImage = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
    <rect width="240" height="160" fill="#cffafe"/>
    <circle cx="120" cy="80" r="48" fill="#0891b2"/>
  </svg>
`)}`;

type OverlayElement = {
  id?: string;
  kind: 'TEXT' | 'IMAGE' | 'SHAPE';
  shape?: 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'ARROW';
  pageIndex: number;
  bbox: {
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
  };
  text?: string;
  assetId?: string;
  start?: { xRatio: number; yRatio: number };
  end?: { xRatio: number; yRatio: number };
  [key: string]: unknown;
};

type ProcedureDocument = {
  id: string;
  name: string;
  imageRelativePath: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  isActive: boolean;
  revisionRootId: string | null;
  supersedesDocumentId: string | null;
  isRevisionHead: boolean;
  editVersion: number;
  pages: Array<{
    pageIndex: number;
    imageRelativePath: string;
    overlays: OverlayElement[];
  }>;
  assets: Record<string, Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

type EditorEvidence = {
  verifyPasswordBodies: Array<Record<string, unknown>>;
  revisionBodies: Array<Record<string, unknown>>;
  textRegionBodies: Array<Record<string, unknown>>;
  imageRegionBodies: Array<Record<string, unknown>>;
  saveBodies: Array<Record<string, unknown>>;
  publishBodies: Array<Record<string, unknown>>;
};

function makeDocument(input: Partial<ProcedureDocument> = {}): ProcedureDocument {
  return {
    id: SOURCE_DOCUMENT_ID,
    name: '公開済み組立手順書',
    imageRelativePath: procedureImage,
    status: 'published',
    publishedAt: NOW,
    isActive: true,
    revisionRootId: null,
    supersedesDocumentId: null,
    isRevisionHead: true,
    editVersion: 0,
    pages: [
      {
        pageIndex: 0,
        imageRelativePath: procedureImage,
        overlays: []
      }
    ],
    assets: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...input
  };
}

function documentWithOverlays(
  document: ProcedureDocument,
  overlays: OverlayElement[],
  editVersion: number
): ProcedureDocument {
  return {
    ...document,
    editVersion,
    updatedAt: `2026-08-21T00:00:${String(editVersion).padStart(2, '0')}.000Z`,
    pages: document.pages.map((page) => ({
      ...page,
      overlays: overlays.filter((element) => element.pageIndex === page.pageIndex)
    }))
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeEditorEvidence(): EditorEvidence {
  return {
    verifyPasswordBodies: [],
    revisionBodies: [],
    textRegionBodies: [],
    imageRegionBodies: [],
    saveBodies: [],
    publishBodies: []
  };
}

async function installEditorApiMocks(
  page: Page,
  evidence: EditorEvidence,
  options: { conflictVersions?: Array<number | null> } = {}
): Promise<void> {
  let sourceDocument = makeDocument();
  let latestDocument = makeDocument({
    id: REVISION_DOCUMENT_ID,
    name: '公開済み組立手順書（改版）',
    status: 'draft',
    publishedAt: null,
    revisionRootId: SOURCE_DOCUMENT_ID,
    supersedesDocumentId: SOURCE_DOCUMENT_ID,
    isRevisionHead: true,
    editVersion: 1
  });
  const conflictVersions = [...(options.conflictVersions ?? [])];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path.startsWith('/src/api/')) {
      await route.continue();
      return;
    }
    if (path.includes('/system/deploy-status/ack')) {
      await route.fulfill({ json: { acknowledged: true } });
      return;
    }
    if (path.includes('/system/deploy-status')) {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }
    if (path.includes('/kiosk/config')) {
      await route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
      return;
    }
    if (path.includes('/kiosk/call/targets')) {
      await route.fulfill({ json: { selfClientId: 'assembly-document-editor-e2e', targets: [] } });
      return;
    }
    if (path.includes('/kiosk/employees')) {
      await route.fulfill({ json: { employees: [] } });
      return;
    }

    if (path === `/api/assembly/procedure-documents/${SOURCE_DOCUMENT_ID}` && method === 'GET') {
      await route.fulfill({ json: { document: clone(sourceDocument) } });
      return;
    }
    if (path === `/api/assembly/procedure-documents/${REVISION_DOCUMENT_ID}` && method === 'GET') {
      await route.fulfill({ json: { document: clone(latestDocument) } });
      return;
    }
    if (path === `/api/assembly/work-sessions/${READONLY_SEQUENCE_SESSION_ID}` && method === 'GET') {
      await route.fulfill({
        json: {
          session: {
            id: READONLY_SEQUENCE_SESSION_ID,
            workUnitId: 'readonly-work-unit',
            lotSerialId: null,
            templateId: 'readonly-template',
            status: 'completed',
            productNo: 'READONLY-PRODUCT',
            serialNo: 'READONLY-SERIAL',
            nameplateNo: 'READONLY-NAMEPLATE',
            operatorEmployeeId: null,
            operatorNameSnapshot: '閲覧者',
            targetUnit: 'unit-1',
            torqueWrenchId: 'none',
            clientDeviceId: null,
            clientDeviceNameSnapshot: null,
            currentAreaId: null,
            currentBoltId: null,
            startedAt: NOW,
            completedAt: NOW,
            cancelledAt: null,
            cancelReason: null,
            createdAt: NOW,
            updatedAt: NOW,
            template: {
              id: 'readonly-template',
              modelCode: 'READONLY',
              procedurePattern: '標準',
              name: '読み取り専用テンプレート',
              version: 1,
              isActive: true,
              traceabilityMode: 'LEGACY',
              procedureDocumentId: SOURCE_DOCUMENT_ID,
              procedureDocument: clone(sourceDocument),
              areas: [],
              checkItems: []
            },
            torqueRecords: [],
            restartLogs: [],
            approval: null,
            areaTorqueSummaries: [],
            checkItems: [],
            checkSummary: { requiredTotal: 0, requiredCompleted: 0, allRequiredCompleted: true }
          }
        }
      });
      return;
    }
    if (path === `/api/assembly/work-sessions/${READONLY_SEQUENCE_SESSION_ID}/procedure-sequence` && method === 'GET') {
      await route.fulfill({
        json: {
          sequence: {
            mode: 'configured',
            source: 'template_version',
            reason: null,
            machineName: 'READONLY',
            machineNameKey: 'readonly',
            stepSource: 'document_expansion',
            documents: [{
              orderItemId: 'readonly-order-item',
              sortOrder: 0,
              label: null,
              documentType: 'assembly_procedure_document',
              kioskDocumentId: null,
              assemblyProcedureDocumentId: SOURCE_DOCUMENT_ID,
              title: sourceDocument.name,
              displayTitle: sourceDocument.name,
              filename: 'readonly-procedure.pdf',
              confirmedDocumentNumber: null,
              confirmedSummaryText: null,
              pageCount: 1,
              updatedAt: NOW,
              pageUrls: [procedureImage],
              pages: [{
                source: 'assembly_procedure_document',
                documentId: SOURCE_DOCUMENT_ID,
                pageIndex: 0,
                pageUrl: procedureImage,
                overlays: []
              }],
              overlays: [],
              assets: {}
            }],
            steps: [{
              id: 'readonly-sequence-step',
              sortOrder: 0,
              kioskDocumentId: null,
              assemblyProcedureDocumentId: SOURCE_DOCUMENT_ID,
              pageIndex: 0,
              viewMode: 'full_page',
              cropXRatio: null,
              cropYRatio: null,
              cropWidthRatio: null,
              cropHeightRatio: null,
              title: '読み取り専用手順',
              instructionText: null,
              emphasis: 'normal',
              documentType: 'assembly_procedure_document',
              documentTitle: sourceDocument.name,
              pageUrl: procedureImage
            }],
            fallbackProcedureDocument: null
          }
        }
      });
      return;
    }
    if (path === '/api/assembly/procedure-documents/summary' || path === '/api/assembly/procedure-documents') {
      const summaryDocument = latestDocument.status === 'published' ? latestDocument : sourceDocument;
      await route.fulfill({
        json: {
          documents: [{
            ...clone(summaryDocument),
            activeTemplateCount: 0,
            totalTemplateCount: 0
          }]
        }
      });
      return;
    }
    if (path === '/api/kiosk/assembly/templates/verify-access-password') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      evidence.verifyPasswordBodies.push(body);
      await route.fulfill({ json: { success: body.password === EDITOR_PASSWORD } });
      return;
    }
    if (path === `/api/assembly/procedure-documents/${SOURCE_DOCUMENT_ID}/revisions` && method === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      evidence.revisionBodies.push(body);
      await route.fulfill({ json: { document: clone(latestDocument) } });
      return;
    }
    if (path.endsWith('/regions/text') && method === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      evidence.textRegionBodies.push(body);
      await route.fulfill({
        json: {
          candidates: [{
            text: '抽出された手順文章',
            confidence: 0.98,
            bounds: {
              xRatio: 0.14,
              yRatio: 0.18,
              widthRatio: 0.3,
              heightRatio: 0.12
            },
            pageIndex: 0,
            source: 'coordinate-ocr'
          }]
        }
      });
      return;
    }
    if (path.endsWith('/regions/image') && method === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      evidence.imageRegionBodies.push(body);
      await route.fulfill({
        json: {
          asset: {
            assetId: 'roi-asset-1',
            storageKey: 'assembly-procedure-assets/roi-asset-1.svg',
            contentType: 'image/svg+xml',
            byteSize: 128,
            relativeUrl: roiImage,
            kind: 'OVERLAY_IMAGE'
          }
        }
      });
      return;
    }
    if (path.endsWith('/overlays') && method === 'PUT') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      evidence.saveBodies.push(body);
      const conflictVersion = conflictVersions.shift();
      if (conflictVersion != null) {
        latestDocument = { ...latestDocument, editVersion: conflictVersion };
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          json: {
            message: '他の編集で更新されています。',
            details: { currentEditVersion: conflictVersion }
          }
        });
        return;
      }
      const overlays = Array.isArray(body.elements) ? clone(body.elements as OverlayElement[]) : [];
      latestDocument = documentWithOverlays(latestDocument, overlays, latestDocument.editVersion + 1);
      await route.fulfill({ json: { document: clone(latestDocument) } });
      return;
    }
    if (path.endsWith('/publish') && method === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      evidence.publishBodies.push(body);
      latestDocument = {
        ...latestDocument,
        status: 'published',
        publishedAt: NOW,
        isActive: true,
        isRevisionHead: true,
        editVersion: latestDocument.editVersion + 1
      };
      sourceDocument = latestDocument;
      await route.fulfill({ json: { document: clone(latestDocument) } });
      return;
    }

    // Template/readonly sequence views share these catalog calls. They must
    // remain harmless and, importantly, do not invoke a region endpoint.
    if (path === '/api/assembly/templates/summary') {
      await route.fulfill({ json: { templates: [] } });
      return;
    }
    if (path === '/api/assembly/library/filter-options') {
      await route.fulfill({ json: { options: [] } });
      return;
    }
    if (path === '/api/assembly/machine-name-candidates') {
      await route.fulfill({ json: { candidates: [], hasMore: false } });
      return;
    }
    if (path.includes('/torque-wrench-capability-groups')) {
      await route.fulfill({ json: { capabilityGroups: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

}

async function authenticateDocumentEditor(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '手順書オーバーレイ編集' })).toBeVisible();
  await page.getByTestId('assembly-document-editor-password').fill(EDITOR_PASSWORD);
  await page.getByRole('button', { name: '認証' }).click();
  await expect(page.getByTestId('assembly-document-editor-layout')).toBeVisible();
  await expect(page.getByRole('region', { name: '手順書キャンバス' })).toBeVisible();
}

async function drawRange(page: Page, start = { x: 0.12, y: 0.16 }, end = { x: 0.38, y: 0.3 }): Promise<void> {
  const surface = page.getByRole('application', { name: 'オーバーレイ範囲選択面' });
  await expect(surface).toBeVisible();
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * start.x, box!.y + box!.height * start.y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * end.x, box!.y + box!.height * end.y);
  await page.mouse.up();
}

async function selectOverlayType(page: Page, label: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '追加する種類を選択' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: new RegExp(`^${label}`) }).click();
}

async function addOverlay(
  page: Page,
  type: '文章' | '画像' | '図形・記号',
  start: { x: number; y: number },
  end: { x: number; y: number }
): Promise<void> {
  await page.getByRole('button', { name: '範囲を追加' }).click();
  await drawRange(page, start, end);
  await selectOverlayType(page, type);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test('published source authenticates into a draft, edits TEXT/ROI IMAGE/ARROW, saves, resolves conflict, and publishes', async ({ page }) => {
  const evidence = makeEditorEvidence();
  await page.setViewportSize({ width: 1366, height: 768 });
  await installEditorApiMocks(page, evidence, { conflictVersions: [null, 4, null, 5] });
  await page.goto(`/kiosk/assembly/procedure-documents/${SOURCE_DOCUMENT_ID}/edit`, {
    waitUntil: 'domcontentloaded'
  });
  await authenticateDocumentEditor(page);

  expect(evidence.verifyPasswordBodies).toEqual([{ password: EDITOR_PASSWORD }]);
  expect(evidence.revisionBodies).toEqual([{ accessPassword: EDITOR_PASSWORD }]);
  await expect(page.getByText('公開済み組立手順書（改版）')).toBeVisible();

  await addOverlay(page, '文章', { x: 0.08, y: 0.1 }, { x: 0.36, y: 0.25 });
  await expect(page.getByRole('dialog', { name: '文章候補を選択' })).toBeVisible();
  await page.getByRole('option', { name: /抽出された手順文章/ }).click();
  const textOverlay = page.getByRole('button', { name: '文章オーバーレイ: 抽出された手順文章' });
  await expect(textOverlay).toBeVisible();
  const inspector = page.getByRole('complementary', { name: 'オーバーレイ編集' });
  await inspector.locator('textarea').fill('編集済みの組立手順');
  await expect(page.getByRole('button', { name: '文章オーバーレイ: 編集済みの組立手順' })).toBeVisible();

  await addOverlay(page, '画像', { x: 0.42, y: 0.16 }, { x: 0.68, y: 0.38 });
  await expect.poll(() => evidence.imageRegionBodies.length).toBe(1);
  await expect(page.getByRole('button', { name: '画像オーバーレイ: roi-asset-1' })).toBeVisible();
  await page
    .getByRole('complementary', { name: 'オーバーレイ編集' })
    .locator('select')
    .first()
    .selectOption('cover');

  await addOverlay(page, '図形・記号', { x: 0.28, y: 0.48 }, { x: 0.68, y: 0.74 });
  const shapeInspector = page.getByRole('complementary', { name: 'オーバーレイ編集' });
  await shapeInspector.locator('select').first().selectOption('ARROW');
  await expect(page.getByRole('button', { name: '図形オーバーレイ: ARROW' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: '手順書キャンバス' })
      .getByTestId('assembly-procedure-overlay-layer')
      .locator('marker')
  ).toHaveCount(1);

  const saveButton = page.getByRole('button', { name: '保存', exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect.poll(() => evidence.saveBodies.length).toBe(1);
  const firstSave = evidence.saveBodies[0]!;
  expect(firstSave).toMatchObject({
    accessPassword: EDITOR_PASSWORD,
    expectedEditVersion: 1
  });
  expect(firstSave.elements).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'TEXT', text: '編集済みの組立手順' }),
    expect.objectContaining({ kind: 'IMAGE', assetId: 'roi-asset-1', objectFit: 'cover' }),
    expect.objectContaining({ kind: 'SHAPE', shape: 'ARROW' })
  ]));
  await expect(page.getByText('オーバーレイを保存しました。')).toBeVisible();

  // A second local change intentionally collides. Both recovery choices must
  // be explicit while the local overlay remains mounted.
  await shapeInspector.locator('select').first().selectOption('ELLIPSE');
  await expect(page.getByRole('button', { name: '図形オーバーレイ: ELLIPSE' })).toBeVisible();
  await saveButton.click();
  await expect.poll(() => evidence.saveBodies.length).toBe(2);
  await expect(page.getByRole('alert')).toContainText('他の編集で更新されています');
  await expect(page.getByRole('button', { name: '最新を再読込（保持内容を破棄）' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保持内容を再保存' })).toBeVisible();
  await expect(page.getByRole('button', { name: '図形オーバーレイ: ELLIPSE' })).toBeVisible();

  await page.getByRole('button', { name: '保持内容を再保存' }).click();
  await expect.poll(() => evidence.saveBodies.length).toBe(3);
  expect(evidence.saveBodies[2]).toMatchObject({ expectedEditVersion: 4 });
  await expect(page.getByText('保持していた内容を再保存しました。')).toBeVisible();

  // Exercise the other explicit conflict choice and verify that only the
  // server's latest saved set survives the confirmed reload.
  await shapeInspector.locator('select').first().selectOption('LINE');
  await expect(page.getByRole('button', { name: '図形オーバーレイ: LINE' })).toBeVisible();
  await saveButton.click();
  await expect.poll(() => evidence.saveBodies.length).toBe(4);
  await page.getByRole('button', { name: '最新を再読込（保持内容を破棄）' }).click();
  const reloadDialog = page.getByRole('dialog', { name: '最新内容を再読込' });
  await expect(reloadDialog).toBeVisible();
  await reloadDialog.getByRole('button', { name: '最新内容へ置換' }).click();
  await expect(page.getByText('最新内容へ置き換えました。')).toBeVisible();
  await expect(page.getByRole('button', { name: '図形オーバーレイ: LINE' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '図形オーバーレイ: ELLIPSE' })).toBeVisible();

  await page.getByRole('button', { name: '公開', exact: true }).click();
  const publishDialog = page.getByRole('dialog', { name: '手順書を公開' });
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole('button', { name: '公開する' }).click();
  await expect.poll(() => evidence.publishBodies.length).toBe(1);
  expect(evidence.publishBodies[0]).toMatchObject({
    accessPassword: EDITOR_PASSWORD,
    expectedEditVersion: 5
  });
  await expect(page).toHaveURL(/\/kiosk\/assembly\/library\?focus=procedures$/);
  await expectNoHorizontalOverflow(page);
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 900, height: 900 }
]) {
  test(`document editor shell remains usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const evidence = makeEditorEvidence();
    await page.setViewportSize(viewport);
    await installEditorApiMocks(page, evidence);
    await page.goto(`/kiosk/assembly/procedure-documents/${SOURCE_DOCUMENT_ID}/edit`, {
      waitUntil: 'domcontentloaded'
    });
    await authenticateDocumentEditor(page);

    const layout = page.getByTestId('assembly-document-editor-layout');
    const canvas = page.getByRole('region', { name: '手順書キャンバス' });
    const inspector = page.getByRole('complementary', { name: 'オーバーレイ編集' });
    await expect(layout).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect(inspector).toBeVisible();
    const layoutBox = await layout.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(layoutBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(layoutBox!.width).toBeGreaterThan(0);
    expect(layoutBox!.height).toBeGreaterThan(0);
    expect(canvasBox!.width).toBeGreaterThanOrEqual(viewport.width >= 1280 ? 500 : 300);
    await expectNoHorizontalOverflow(page);
  });
}

test('readonly template procedure view renders the source without ROI or OCR requests', async ({ page }) => {
  const evidence = makeEditorEvidence();
  const regionRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith('/api/') &&
      (path.includes('/regions/') || path.toLowerCase().includes('ocr'))
    ) {
      regionRequests.push(path);
    }
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await installEditorApiMocks(page, evidence);
  await page.goto(`/kiosk/assembly/templates/new?procedureDocumentId=${SOURCE_DOCUMENT_ID}`, {
    waitUntil: 'domcontentloaded'
  });
  await expect(page.getByPlaceholder('パスワード')).toBeVisible();
  await page.getByPlaceholder('パスワード').fill(EDITOR_PASSWORD);
  await page.getByRole('button', { name: '認証' }).click();
  await expect(page.getByTestId('assembly-procedure-canvas')).toBeVisible();
  await expect(page.getByTestId('assembly-unified-editor-workspace')).toBeVisible();
  await page.goto(`/kiosk/assembly/work-sessions/${READONLY_SEQUENCE_SESSION_ID}`, {
    waitUntil: 'domcontentloaded'
  });
  await expect(page.getByTestId('assembly-procedure-sequence-toolbar')).toBeVisible();
  await expect(page.getByTestId('assembly-work-step-canvas')).toBeVisible();
  expect(regionRequests).toEqual([]);
  expect(evidence.textRegionBodies).toEqual([]);
  expect(evidence.imageRegionBodies).toEqual([]);
});
