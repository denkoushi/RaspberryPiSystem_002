import { expect, test, type Locator, type Page } from '@playwright/test';

const CLIENT_KEY = 'client-key-kiosk-self-inspection-work-instruction-overlay-editing';
const EMPLOYEE_TAG_UID = 'employee-nfc-e2e';
const EDITOR_AUTHENTICATION_ID = 'editor-authentication-e2e';
const EMPLOYEE_ID = 'employee-e2e';
const EMPLOYEE_CODE = 'E2E001';
const EMPLOYEE_NAME = 'E2E 作業者';
const CLIENT_DEVICE_ID = 'client-device-e2e';
const CLIENT_DEVICE_NAME = 'E2E Kiosk';
const PART_NUMBER = 'FH-24A-018-EDIT';
const SHOOTING_TARGET = '研削';
const SOURCE_ASSET_ID = 'source-asset-1';
const SOURCE_IMAGE_PATH = `/api/work-instructions/assets/${SOURCE_ASSET_ID}`;
const VERTICAL_SOURCE_ASSET_ID = 'source-asset-vertical-2';
const VERTICAL_SOURCE_IMAGE_PATH = `/api/work-instructions/assets/${VERTICAL_SOURCE_ASSET_ID}`;
const SOURCE_VERSION_ID = 'archived-source-version';
const PUBLISHED_VERSION_ID = 'published-source-version';
const LATEST_VERSION_ID = 'latest-source-version';
const REVISION_ID = 'editor-draft-1';
const STEP_KEY = 'SharePoint:WorkInstructions:101:1';
const VERTICAL_STEP_KEY = 'SharePoint:WorkInstructions:101:2';

const sourceImage = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#e2e8f0"/><text x="80" y="280" font-size="64">研削</text></svg>';
const verticalSourceImage = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="900"><rect width="360" height="900" fill="#cbd5e1"/><text x="35" y="460" font-size="36">手順2</text></svg>';
const bbox = { xRatio: 0.1, yRatio: 0.15, widthRatio: 0.3, heightRatio: 0.2 };

function editorAuthentication() {
  const authenticatedAt = new Date().toISOString();
  return {
    id: EDITOR_AUTHENTICATION_ID,
    employee: { id: EMPLOYEE_ID, employeeCode: EMPLOYEE_CODE, displayName: EMPLOYEE_NAME },
    authenticatedAt,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  };
}

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
    memoFingerprint: sourceVersionId === LATEST_VERSION_ID ? 'latest-memo-fingerprint' : 'published-memo-fingerprint',
    overlays
  };
}

function verticalSourceStep(sourceVersionId: string) {
  return {
    ...sourceStep(sourceVersionId),
    stepKey: VERTICAL_STEP_KEY,
    step: 2,
    text: '縦長画像の手順を確認します。',
    imageName: 'vertical-source.png',
    imageAssetId: VERTICAL_SOURCE_ASSET_ID,
    imageUrl: VERTICAL_SOURCE_IMAGE_PATH,
    imageSha256: 'b'.repeat(64)
  };
}

function sourceVersion(id: string, status: string, overlays: Array<Record<string, unknown>> = []) {
  return {
    id,
    revisionNumber: id === LATEST_VERSION_ID ? 2 : 1,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: id === LATEST_VERSION_ID ? 'latest-hash' : 'published-hash',
    status,
    steps: [sourceStep(id, overlays), verticalSourceStep(id)],
    images: [{
      assetId: SOURCE_ASSET_ID,
      imageName: 'source.png',
      imageUrl: SOURCE_IMAGE_PATH,
      imageMimeType: 'image/png',
      imageSha256: 'a'.repeat(64),
      deletedAt: null,
      deletedBy: null,
      canDeleteImage: false
    }, {
      assetId: VERTICAL_SOURCE_ASSET_ID,
      imageName: 'vertical-source.png',
      imageUrl: VERTICAL_SOURCE_IMAGE_PATH,
      imageMimeType: 'image/png',
      imageSha256: 'b'.repeat(64),
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

function editorDraft(
  overlays: Array<Record<string, unknown>> = [migratedNote],
  editVersion = 0,
  memoOverrides: Array<Record<string, unknown>> = []
) {
  return {
    id: REVISION_ID,
    sourceVersionId: LATEST_VERSION_ID,
    status: 'draft',
    revisionNumber: 1,
    editVersion,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: 'latest-hash',
    baseContentHash: 'published-hash',
    steps: [sourceStep(LATEST_VERSION_ID, overlays), verticalSourceStep(LATEST_VERSION_ID)],
    overlays,
    memoOverrides,
    assets: {}
  };
}

async function installMockNfc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type TestWindow = Window & {
      __editorNfcReady?: boolean;
      __emitEditorNfc?: (uid: string) => void;
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
          (window as TestWindow).__editorNfcReady = true;
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
    const testWindow = window as TestWindow;
    testWindow.__editorNfcReady = false;
    testWindow.__emitEditorNfc = (uid: string) => {
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
  await expect.poll(() => page.evaluate(() => {
    const testWindow = window as Window & { __editorNfcReady?: boolean };
    return testWindow.__editorNfcReady === true;
  })).toBe(true);
  await page.evaluate((value) => {
    const testWindow = window as Window & {
      __emitEditorNfc?: (nextUid: string) => void;
    };
    testWindow.__emitEditorNfc?.(value);
  }, uid);
}

async function installApiMocks(page: Page) {
  let draft: Record<string, unknown> | null = null;
  let oldImageDeleted = false;
  const trace = { authentication: 0, copy: 0, save: 0, publish: 0, delete: 0, group: 0, history: 0, audit: 0 };

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
    if (path === '/api/work-instructions/editor-authentications' && request.method() === 'POST') {
      trace.authentication += 1;
      expect(request.headers()['x-client-key']).toBe(CLIENT_KEY);
      expect(request.postDataJSON()).toEqual({
        partNumber: PART_NUMBER,
        shootingTarget: SHOOTING_TARGET,
        employeeTagUid: EMPLOYEE_TAG_UID
      });
      expect(request.postDataJSON()).not.toHaveProperty('accessPassword');
      await route.fulfill({ json: { authentication: editorAuthentication() } });
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
      expect(request.headers()['x-work-instruction-editor-authentication-id']).toBe(EDITOR_AUTHENTICATION_ID);
      await route.fulfill({ json: { history: editorGroup(draft, oldImageDeleted).history } });
      return;
    }
    if (path === '/api/work-instructions/editor-audit' && request.method() === 'GET') {
      trace.audit += 1;
      expect(request.headers()['x-work-instruction-editor-authentication-id']).toBe(EDITOR_AUTHENTICATION_ID);
      await route.fulfill({ json: {
        items: [{
          id: 'audit-log-1',
          action: 'SAVED',
          employeeIdSnapshot: EMPLOYEE_ID,
          employeeCodeSnapshot: EMPLOYEE_CODE,
          employeeNameSnapshot: EMPLOYEE_NAME,
          clientDeviceIdSnapshot: CLIENT_DEVICE_ID,
          clientDeviceNameSnapshot: CLIENT_DEVICE_NAME,
          partNumber: PART_NUMBER,
          shootingTarget: SHOOTING_TARGET,
          rowId: 'source-row-1',
          sourceVersionId: LATEST_VERSION_ID,
          revisionId: REVISION_ID,
          editVersionBefore: 0,
          editVersionAfter: 1,
          requestId: 'request-audit-1',
          changeSet: { overlays: { added: ['audit-overlay-1'] }, memos: { changed: ['memo-1'] } },
          createdAt: '2026-09-02T00:00:00.000Z'
        }]
      } });
      return;
    }
    if (path === '/api/work-instructions/editor-revisions/copy' && request.method() === 'POST') {
      trace.copy += 1;
      expect(request.headers()['x-work-instruction-editor-authentication-id']).toBe(EDITOR_AUTHENTICATION_ID);
      expect(request.postDataJSON()).not.toHaveProperty('accessPassword');
      draft = editorDraft();
      await route.fulfill({ json: { group: editorGroup(draft, oldImageDeleted), revisions: [draft] } });
      return;
    }
    if (path.startsWith('/api/work-instructions/editor-revisions/') && path.endsWith('/draft') && request.method() === 'PUT') {
      trace.save += 1;
      expect(request.headers()['x-work-instruction-editor-authentication-id']).toBe(EDITOR_AUTHENTICATION_ID);
      expect(request.postDataJSON()).not.toHaveProperty('accessPassword');
      const body = request.postDataJSON() as {
        elements?: Array<Record<string, unknown>>;
        memoOverrides?: Array<Record<string, unknown>>;
      };
      const elements = body.elements ?? [];
      const memoOverrides = body.memoOverrides ?? [];
      // Match the canonical save response: derived steps are supplied by the
      // group projection, so the controller must re-compose them locally.
      draft = { ...editorDraft(elements, 1, memoOverrides), steps: [], overlays: elements };
      await route.fulfill({ json: { revision: draft } });
      return;
    }
    if (path === '/api/work-instructions/editor-revisions/publish' && request.method() === 'POST') {
      trace.publish += 1;
      expect(request.headers()['x-work-instruction-editor-authentication-id']).toBe(EDITOR_AUTHENTICATION_ID);
      expect(request.postDataJSON()).not.toHaveProperty('accessPassword');
      await route.fulfill({ json: { group: editorGroup(null, oldImageDeleted) } });
      return;
    }
    if (path === `/api/work-instructions/source-versions/${SOURCE_VERSION_ID}/image` && request.method() === 'DELETE') {
      trace.delete += 1;
      expect(request.headers()['x-work-instruction-editor-authentication-id']).toBe(EDITOR_AUTHENTICATION_ID);
      expect(request.postData() ?? '').not.toContain('accessPassword');
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
    if (path === VERTICAL_SOURCE_IMAGE_PATH) {
      await route.fulfill({ contentType: 'image/svg+xml', body: verticalSourceImage });
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
  await expect(page.getByTestId('work-instruction-editor-nfc-gate')).toBeVisible();
}

async function expectContainedImage(
  pane: Locator,
  frameTestId = 'image-overlay-frame',
  naturalSize = { width: 900, height: 540 }
): Promise<void> {
  const viewport = pane.getByTestId(frameTestId).first();
  const image = viewport.locator('img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => ({
    width: element.naturalWidth,
    height: element.naturalHeight
  }))).toEqual(naturalSize);

  const contentFrameBox = () => image.evaluate((element) => {
    const rect = element.parentElement?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  });
  const isContainedAtExpectedRatio = async () => {
    const [viewportBox, frameBox] = await Promise.all([
      viewport.boundingBox(),
      contentFrameBox()
    ]);
    if (!viewportBox || !frameBox || frameBox.width <= 0 || frameBox.height <= 0) return false;
    const ratio = frameBox.width / frameBox.height;
    const expectedRatio = naturalSize.width / naturalSize.height;
    const boxTolerance = 2;
    const ratioTolerance = 0.03;
    return Math.abs(ratio - expectedRatio) / expectedRatio <= ratioTolerance
      && frameBox.x >= viewportBox.x - boxTolerance
      && frameBox.y >= viewportBox.y - boxTolerance
      && frameBox.x + frameBox.width <= viewportBox.x + viewportBox.width + boxTolerance
      && frameBox.y + frameBox.height <= viewportBox.y + viewportBox.height + boxTolerance
      && (Math.abs(frameBox.width - viewportBox.width) <= boxTolerance
        || Math.abs(frameBox.height - viewportBox.height) <= boxTolerance);
  };
  await expect.poll(isContainedAtExpectedRatio).toBe(true);

  const [viewportBox, frameBox] = await Promise.all([
    viewport.boundingBox(),
    contentFrameBox()
  ]);
  expect(viewportBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  if (!viewportBox || !frameBox) return;

  const boxTolerance = 2;
  expect(frameBox.x).toBeGreaterThanOrEqual(viewportBox.x - boxTolerance);
  expect(frameBox.y).toBeGreaterThanOrEqual(viewportBox.y - boxTolerance);
  expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width + boxTolerance);
  expect(frameBox.y + frameBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height + boxTolerance);
  expect(
    Math.abs(frameBox.width - viewportBox.width) <= boxTolerance
      || Math.abs(frameBox.height - viewportBox.height) <= boxTolerance
  ).toBe(true);
  expect(Math.abs((frameBox.width / frameBox.height) - (naturalSize.width / naturalSize.height)) / (naturalSize.width / naturalSize.height)).toBeLessThanOrEqual(0.03);
}

async function expectEditorInspectorContrast(page: Page): Promise<void> {
  const inspector = page.getByRole('complementary', { name: '加工要領書オーバーレイ編集', exact: true });
  const controls = inspector.locator('input, textarea, select');
  await expect(controls).not.toHaveCount(0);
  const styles = await controls.evaluateAll((elements) => elements.map((element) => {
    const computed = window.getComputedStyle(element);
    return { color: computed.color, backgroundColor: computed.backgroundColor };
  }));
  expect(styles.length).toBeGreaterThan(0);
  for (const style of styles) {
    expect(style.color).toBe('rgb(255, 255, 255)');
    expect(style.backgroundColor).toBe('rgb(2, 6, 23)');
  }
}

test.use({
  userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
});

for (const viewport of [
  { width: 640, height: 900 },
  { width: 1920, height: 1080 }
] as const) {
  test(`${viewport.width}px: 閲覧から移植・保存・公開・旧画像削除まで完遂する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMockNfc(page);
    const trace = await installApiMocks(page);
    await openEditorFromViewer(page);

    await emitNfc(page, EMPLOYEE_TAG_UID);
    await expect(page.getByRole('heading', { name: '加工要領書を編集', exact: true })).toBeVisible();
    await expect.poll(() => trace.authentication).toBe(1);
    await expect.poll(() => trace.copy).toBe(1);
    await expect.poll(() => trace.audit).toBeGreaterThan(0);
    const comparisonLayout = page.getByTestId('work-instruction-editor-comparison-layout');
    await expect(comparisonLayout).toBeVisible();
    await expect(page.getByTestId('work-instruction-version-comparison')).toContainText('公開版（使用側）');
    await expect(page.getByTestId('work-instruction-version-comparison')).toContainText('最新原本（移植先）');
    const [targetPaneBox, comparisonPaneBox] = await Promise.all([
      page.getByTestId('work-instruction-editor-target-pane').boundingBox(),
      page.getByTestId('work-instruction-editor-comparison-pane').boundingBox()
    ]);
    expect(targetPaneBox).not.toBeNull();
    expect(comparisonPaneBox).not.toBeNull();
    if (targetPaneBox && comparisonPaneBox) {
      const targetHeightShare = targetPaneBox.height / (targetPaneBox.height + comparisonPaneBox.height);
      expect(targetHeightShare).toBeGreaterThan(0.56);
      expect(targetHeightShare).toBeLessThan(0.64);
    }
    const [publishedPaneBox, latestPaneBox] = await Promise.all([
      page.getByRole('region', { name: '公開版（使用側）' }).boundingBox(),
      page.getByRole('region', { name: '最新原本（移植先）' }).boundingBox()
    ]);
    expect(publishedPaneBox).not.toBeNull();
    expect(latestPaneBox).not.toBeNull();
    if (publishedPaneBox && latestPaneBox) {
      expect(Math.abs(publishedPaneBox.height - latestPaneBox.height)).toBeLessThanOrEqual(2);
    }
    await expectContainedImage(page.getByTestId('work-instruction-editor-target-pane'), 'work-instruction-editor-canvas');
    await expectContainedImage(page.getByRole('region', { name: '公開版（使用側）' }));
    await expectContainedImage(page.getByRole('region', { name: '最新原本（移植先）' }));
    const stepsPane = page.getByRole('complementary', { name: '手順一覧', exact: true });
    await stepsPane.getByRole('button', { name: /手順 2/ }).click();
    await expectContainedImage(
      page.getByTestId('work-instruction-editor-target-pane'),
      'work-instruction-editor-canvas',
      { width: 360, height: 900 }
    );
    await stepsPane.getByRole('button', { name: /手順 1/ }).click();
    await expectContainedImage(page.getByTestId('work-instruction-editor-target-pane'), 'work-instruction-editor-canvas');
    await expect(page.getByTestId('work-instruction-editor-history-pane')).toHaveCount(0);
    await page.getByRole('button', { name: '履歴を表示', exact: true }).click();
    const historyPane = page.getByTestId('work-instruction-editor-history-pane');
    await expect(historyPane).toBeVisible();
    await expect(historyPane).toContainText('編集操作履歴');
    await expect(historyPane).toContainText(EMPLOYEE_NAME);
    await expect(historyPane).toContainText(`社員コード ${EMPLOYEE_CODE}`);
    await expect(historyPane).toContainText(`端末: ${CLIENT_DEVICE_NAME}`);
    await historyPane.getByText('詳細差分', { exact: true }).click();
    await expect(historyPane).toContainText('audit-overlay-1');
    await page.getByRole('button', { name: '履歴を隠す', exact: true }).click();
    await expect(page.getByTestId('work-instruction-editor-history-pane')).toHaveCount(0);
    await expect(page.getByTestId('work-instruction-memo-editor')).toBeVisible();

    const migratedOverlay = page.getByRole('button', { name: '文章オーバーレイ: 旧版注記', exact: true });
    await expect(migratedOverlay).toBeVisible();
    await migratedOverlay.click();
    await expectEditorInspectorContrast(page);
    const migrationSelect = page.locator('label').filter({ hasText: '移植状態（公開前に確認）' }).getByRole('combobox');
    await migrationSelect.selectOption('MIGRATED');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => trace.save).toBe(1);
    await expect(page.getByTestId('work-instruction-editor-toolbar-message')).toHaveText('オーバーレイを保存しました。');
    await expect(comparisonLayout.getByText('オーバーレイを保存しました。', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '一括公開', exact: true }).click();
    await page.getByRole('button', { name: '公開する', exact: true }).click();
    await expect.poll(() => trace.publish).toBe(1);
    await expect(page.getByText('加工要領書を公開しました。使用側の表示を更新できます。', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '履歴を表示', exact: true }).click();
    await expect(page.getByTestId('work-instruction-editor-history-pane')).toBeVisible();
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
