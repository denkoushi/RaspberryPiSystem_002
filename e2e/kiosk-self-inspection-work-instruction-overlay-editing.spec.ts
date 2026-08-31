import { expect, test, type Page } from '@playwright/test';

const CLIENT_KEY = 'client-key-kiosk-self-inspection-work-instruction-overlay-editing';
const PART_NUMBER = 'FH-24A-018-EDIT';
const SHOOTING_TARGET = '研削';
const SOURCE_ASSET_ID = 'source-asset-1';
const SOURCE_IMAGE_PATH = `/api/work-instructions/assets/${SOURCE_ASSET_ID}`;
const SOURCE_VERSION_ID = 'archived-source-version';
const PUBLISHED_VERSION_ID = 'published-source-version';
const LATEST_VERSION_ID = 'latest-source-version';
const REVISION_ID = 'editor-draft-1';
const STEP_KEY = 'SharePoint:WorkInstructions:101:1';

const sourceImage = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#e2e8f0"/><text x="80" y="280" font-size="64">研削</text></svg>';
const bbox = { xRatio: 0.1, yRatio: 0.15, widthRatio: 0.3, heightRatio: 0.2 };

function sourceStep(sourceVersionId: string, overlays: Array<Record<string, unknown>> = []) {
  return {
    stepKey: STEP_KEY,
    sourceVersionId,
    sourceSystem: 'SharePoint',
    sourceList: 'WorkInstructions',
    sourceItemId: 101,
    step: 1,
    text: '加工面を確認します。',
    imageName: 'source.png',
    imageAssetId: SOURCE_ASSET_ID,
    imageUrl: SOURCE_IMAGE_PATH,
    imageMimeType: 'image/png',
    imageSha256: 'a'.repeat(64),
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: sourceVersionId === LATEST_VERSION_ID ? 'latest-hash' : 'published-hash',
    overlays
  };
}

function sourceVersion(id: string, status: string, overlays: Array<Record<string, unknown>> = []) {
  return {
    id,
    revisionNumber: id === LATEST_VERSION_ID ? 2 : 1,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: id === LATEST_VERSION_ID ? 'latest-hash' : 'published-hash',
    status,
    steps: [sourceStep(id, overlays)],
    images: [{
      assetId: SOURCE_ASSET_ID,
      imageName: 'source.png',
      imageUrl: SOURCE_IMAGE_PATH,
      imageMimeType: 'image/png',
      imageSha256: 'a'.repeat(64),
      deletedAt: null,
      deletedBy: null,
      canDeleteImage: false
    }]
  };
}

const migratedNote = {
  id: 'migrated-note',
  pageIndex: 0,
  bbox,
  zIndex: 1,
  kind: 'TEXT',
  text: '旧版注記',
  stepKey: STEP_KEY,
  sourceStep: 1,
  migratedFromStep: 1,
  baseStepFingerprint: 'published-hash',
  targetStepFingerprint: 'latest-hash',
  migrationState: 'NEEDS_REVIEW'
};

function historyItem(canDeleteImage: boolean, imageDeletedAt: string | null = null) {
  return {
    id: `history-${SOURCE_VERSION_ID}`,
    rowId: 'source-row-1',
    sourceVersionId: SOURCE_VERSION_ID,
    revisionNumber: 1,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: 'archived-hash',
    status: 'archived',
    isLatest: false,
    isPublished: false,
    publishedRevisionId: null,
    annotationRevisionId: null,
    imageCount: 1,
    deletedImageCount: imageDeletedAt ? 1 : 0,
    eligibleImageCount: canDeleteImage ? 1 : 0,
    canDeleteImage,
    imageDeletedAt,
    imageDeletedBy: imageDeletedAt ? 'admin' : null,
    images: [{
      assetId: SOURCE_ASSET_ID,
      imageName: 'source.png',
      imageUrl: SOURCE_IMAGE_PATH,
      imageMimeType: 'image/png',
      imageSha256: 'a'.repeat(64),
      deletedAt: imageDeletedAt,
      deletedBy: imageDeletedAt ? 'admin' : null,
      canDeleteImage
    }]
  };
}

function editorGroup(draft: Record<string, unknown> | null, oldImageDeleted: boolean) {
  const history = [historyItem(!oldImageDeleted, oldImageDeleted ? '2026-08-31T01:00:00.000Z' : null)];
  return {
    partNumber: PART_NUMBER,
    shootingTarget: SHOOTING_TARGET,
    rows: [{
      rowId: 'source-row-1',
      source: { system: 'SharePoint', list: 'WorkInstructions', itemId: 101, modified: '2026-08-31T00:00:00.000Z' },
      published: sourceVersion(PUBLISHED_VERSION_ID, 'published', []),
      latest: sourceVersion(LATEST_VERSION_ID, 'latest', []),
      draft,
      updateAvailable: true,
      history,
      migration: { total: draft ? 1 : 0, migrated: 0, needsReview: draft ? 1 : 0, unassigned: 0, skipped: 0 }
    }],
    migration: { total: draft ? 1 : 0, migrated: 0, needsReview: draft ? 1 : 0, unassigned: 0, skipped: 0 },
    history
  };
}

function editorDraft(overlays: Array<Record<string, unknown>> = [migratedNote], editVersion = 0) {
  return {
    id: REVISION_ID,
    sourceVersionId: LATEST_VERSION_ID,
    status: 'draft',
    revisionNumber: 1,
    editVersion,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: 'latest-hash',
    baseContentHash: 'published-hash',
    steps: [sourceStep(LATEST_VERSION_ID, overlays)],
    overlays,
    assets: {}
  };
}

async function installApiMocks(page: Page) {
  let draft: Record<string, unknown> | null = null;
  let oldImageDeleted = false;
  const trace = { copy: 0, save: 0, publish: 0, delete: 0, group: 0, history: 0 };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.startsWith('/src/api/')) {
      await route.continue();
      return;
    }

    if (path === '/api/system/deploy-status') {
      await route.fulfill({ json: { isMaintenance: false } });
      return;
    }
    if (path === '/api/kiosk/config') {
      await route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
      return;
    }
    if (path === '/api/kiosk/call/targets') {
      await route.fulfill({ json: { selfClientId: 'work-instruction-overlay-editing-e2e', targets: [] } });
      return;
    }
    if (path === '/api/kiosk/employees') {
      await route.fulfill({ json: { employees: [] } });
      return;
    }
    if (path === '/api/part-measurement/self-inspection/sessions') {
      await route.fulfill({ json: { sessions: [], truncated: false, listLimit: 200 } });
      return;
    }
    if (path === '/api/kiosk/production-schedule/resources') {
      await route.fulfill({ json: { resources: [], resourceNameMap: {} } });
      return;
    }
    if (path === '/api/kiosk/production-schedule') {
      await route.fulfill({ json: { page: 1, pageSize: 50, rows: [], hasMore: false } });
      return;
    }
    if (path === '/api/work-instructions/groups') {
      await route.fulfill({ json: { groups: [{ partNumber: PART_NUMBER, shootingTarget: SHOOTING_TARGET, rowCount: 1, stepCount: 1, latestModified: '2026-08-31T00:00:00.000Z' }], limit: 100, offset: 0 } });
      return;
    }
    if (path === '/api/work-instructions/group') {
      const step = sourceStep(PUBLISHED_VERSION_ID, [migratedNote]);
      await route.fulfill({
        json: {
          partNumber: PART_NUMBER,
          shootingTarget: SHOOTING_TARGET,
          rows: [{
            id: 'source-row-1',
            source: { system: 'SharePoint', list: 'WorkInstructions', itemId: 101, modified: '2026-08-31T00:00:00.000Z' },
            partNumber: PART_NUMBER,
            shootingTarget: SHOOTING_TARGET,
            contentHash: 'published-hash',
            rawManifest: { schema_version: 1 },
            steps: [step],
            createdAt: '2026-08-31T00:00:00.000Z',
            updatedAt: '2026-08-31T00:00:00.000Z'
          }],
          steps: [step],
          updateAvailable: true
        }
      });
      return;
    }
    if (path === '/api/work-instructions/editor-group' && request.method() === 'GET') {
      trace.group += 1;
      await route.fulfill({ json: editorGroup(draft, oldImageDeleted) });
      return;
    }
    if (path === '/api/work-instructions/editor-revisions/history' && request.method() === 'GET') {
      trace.history += 1;
      await route.fulfill({ json: { history: editorGroup(draft, oldImageDeleted).history } });
      return;
    }
    if (path === '/api/work-instructions/editor-revisions/copy' && request.method() === 'POST') {
      trace.copy += 1;
      draft = editorDraft();
      await route.fulfill({ json: { group: editorGroup(draft, oldImageDeleted), revisions: [draft] } });
      return;
    }
    if (path.startsWith('/api/work-instructions/editor-revisions/') && path.endsWith('/overlays') && request.method() === 'PUT') {
      trace.save += 1;
      const body = request.postDataJSON() as { elements?: Array<Record<string, unknown>> };
      const elements = body.elements ?? [];
      // Match the canonical save response: derived steps are supplied by the
      // group projection, so the controller must re-compose them locally.
      draft = { ...editorDraft(elements, 1), steps: [], overlays: elements };
      await route.fulfill({ json: { revision: draft } });
      return;
    }
    if (path === '/api/work-instructions/editor-revisions/publish' && request.method() === 'POST') {
      trace.publish += 1;
      await route.fulfill({ json: { group: editorGroup(null, oldImageDeleted) } });
      return;
    }
    if (path === `/api/work-instructions/source-versions/${SOURCE_VERSION_ID}/image` && request.method() === 'DELETE') {
      trace.delete += 1;
      oldImageDeleted = true;
      await route.fulfill({
        json: {
          results: [{ assetId: SOURCE_ASSET_ID, auditId: 'audit-1', status: 'DELETED' }],
          deletedCount: 1,
          deletedImageCount: 1,
          failedCount: 0
        }
      });
      return;
    }
    if (path === SOURCE_IMAGE_PATH || path === `/api/work-instructions/edit-assets/${SOURCE_ASSET_ID}`) {
      await route.fulfill({ contentType: 'image/svg+xml', body: sourceImage });
      return;
    }

    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });

  await page.addInitScript(({ clientKey }) => {
    localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
    localStorage.setItem('factory-auth', JSON.stringify({
      token: 'e2e-admin-token',
      refresh: 'e2e-refresh-token',
      user: { id: 'admin-e2e', username: 'admin', role: 'ADMIN', status: 'ACTIVE' }
    }));
  }, { clientKey: CLIENT_KEY });

  return trace;
}

async function openEditorFromViewer(page: Page): Promise<void> {
  await page.goto(`/kiosk/part-measurement/self-inspection?partNumber=${encodeURIComponent(PART_NUMBER)}&shootingTarget=${encodeURIComponent(SHOOTING_TARGET)}`, { waitUntil: 'domcontentloaded' });
  const viewer = page.getByRole('dialog', { name: '作業要領書', exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('button', { name: '編集', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: '編集', exact: true }).click();
  await expect(page).toHaveURL(/work-instructions\/edit/);
  await expect(page.getByTestId('work-instruction-editor-password')).toBeVisible();
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1800, height: 1000 }
] as const) {
  test(`${viewport.width}px: 閲覧から移植・保存・公開・旧画像削除まで完遂する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const trace = await installApiMocks(page);
    await openEditorFromViewer(page);

    await page.getByTestId('work-instruction-editor-password').fill('2520');
    await page.getByTestId('work-instruction-editor-authenticate').click();
    await expect(page.getByRole('heading', { name: '加工要領書を編集', exact: true })).toBeVisible();
    await expect(page.getByTestId('work-instruction-version-comparison')).toContainText('公開版（使用側）');
    await expect(page.getByTestId('work-instruction-version-comparison')).toContainText('最新原本（移植先）');

    const migratedOverlay = page.getByRole('button', { name: '文章オーバーレイ: 旧版注記', exact: true });
    await expect(migratedOverlay).toBeVisible();
    await migratedOverlay.click();
    const migrationSelect = page.locator('label').filter({ hasText: '移植状態（公開前に確認）' }).getByRole('combobox');
    await migrationSelect.selectOption('MIGRATED');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => trace.save).toBe(1);
    await expect(page.getByText('オーバーレイを保存しました。', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '一括公開', exact: true }).click();
    await page.getByRole('button', { name: '公開する', exact: true }).click();
    await expect.poll(() => trace.publish).toBe(1);
    await expect(page.getByText('加工要領書を公開しました。使用側の表示を更新できます。', { exact: true })).toBeVisible();

    const deleteButton = page.getByRole('button', { name: '旧画像を一括削除', exact: true });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    await page.getByRole('button', { name: '削除する', exact: true }).click();
    await expect.poll(() => trace.delete).toBe(1);
    await expect.poll(() => trace.group).toBeGreaterThan(1);
    await expect.poll(() => trace.history).toBeGreaterThan(0);
    await expect(page.getByText('画像削除済み', { exact: true })).toBeVisible();
  });
}
