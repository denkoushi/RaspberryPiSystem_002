const visualTemplate = Object.freeze({
  id: 'sop-visual-1',
  name: '図面71-A61',
  searchDigits: '7161',
  drawingImageRelativePath: '/api/storage/part-measurement-drawings/sop-visual-1.svg',
  isActive: true,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z'
});

const activeTemplate = Object.freeze({
  id: 'sop-template-1',
  fhincd: 'PART-9000',
  resourceCd: 'R001',
  processGroup: 'cutting',
  templateScope: 'three_key',
  candidateFhinmei: null,
  name: '図面71-A61 テンプレート',
  version: 3,
  isActive: true,
  selfInspectionMode: 'fixed_count',
  selfInspectionFixedCount: 3,
  selfInspectionSampleSize: 3,
  visualTemplateId: visualTemplate.id,
  visualTemplate,
  siblingGroupId: 'sop-group-1',
  siblingGroup: {
    id: 'sop-group-1',
    displayName: 'PART-9000 切削',
    fhincd: 'PART-9000',
    processGroup: 'cutting',
    activeResourceCds: ['R001', 'R002'],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z'
  },
  items: [
    { id: 'item-1', sortOrder: 0, datumSurface: 'A', measurementPoint: '外径', measurementLabel: '外径', displayMarker: '1', unit: 'mm', allowNegative: true, decimalPlaces: 3, markerXRatio: '0.35', markerYRatio: '0.42', calloutTipXRatio: null, calloutTipYRatio: null, nominalValue: '20', lowerLimit: '19.98', upperLimit: '20.02', depthMode: 'measured', valueKind: 'numeric' },
    { id: 'item-2', sortOrder: 1, datumSurface: 'B', measurementPoint: '全長', measurementLabel: '全長', displayMarker: '2', unit: 'mm', allowNegative: true, decimalPlaces: 2, markerXRatio: '0.67', markerYRatio: '0.55', calloutTipXRatio: '0.73', calloutTipYRatio: '0.48', nominalValue: '71', lowerLimit: '70.9', upperLimit: '71.1', depthMode: 'measured', valueKind: 'numeric' },
    { id: 'item-3', sortOrder: 2, datumSurface: 'C', measurementPoint: 'ネジ穴深さ', measurementLabel: 'ネジ穴深さ', displayMarker: '3', unit: 'mm', allowNegative: true, decimalPlaces: 2, markerXRatio: '0.79', markerYRatio: '0.37', calloutTipXRatio: null, calloutTipYRatio: null, nominalValue: '12', lowerLimit: '11.9', upperLimit: '12.1', depthMode: 'measured', valueKind: 'numeric' }
  ]
});

const historyTemplate = Object.freeze({ ...activeTemplate, isActive: false, version: 2 });
const summaryTemplate = Object.freeze({
  ...activeTemplate,
  items: undefined,
  itemCount: activeTemplate.items.length,
  updatedAt: '2026-07-28T00:00:00.000Z'
});

const svgBody = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#f8fafc"/><g stroke="#334155" fill="none" stroke-width="4"><path d="M120 180h700v240H120z"/><circle cx="300" cy="300" r="95"/><circle cx="650" cy="300" r="60"/><path d="M205 300h190M300 205v190M590 300h120"/></g><g fill="#0f172a" font-family="sans-serif" font-size="36"><text x="120" y="130">PART-9000  検査図面</text><text x="240" y="520">φ20 ±0.02</text><text x="610" y="520">71 ±0.10</text></g></svg>';

const ocrStatus = Object.freeze({
  id: 'sop-ocr-1',
  visualTemplateId: visualTemplate.id,
  status: 'completed',
  ocrVersion: 'sop-v1',
  drawingImageFingerprint: 'sop-fixture',
  engine: 'fixture',
  imageWidth: 1000,
  imageHeight: 600,
  tokenCount: 1,
  payloadBytes: 64,
  queuePriority: 0,
  attemptCount: 1,
  failureReason: null,
  ocrStartedAt: '2026-07-28T00:00:00.000Z',
  ocrFinishedAt: '2026-07-28T00:00:01.000Z',
  lastQueuedAt: '2026-07-28T00:00:00.000Z',
  nextAttemptAt: null,
  updatedAt: '2026-07-28T00:00:01.000Z'
});

const ocrCandidate = Object.freeze({
  valueText: '12', rawText: '12', confidence: 0.99, score: 1, distanceRatio: 0.01,
  xRatio: 0.79, yRatio: 0.37, widthRatio: 0.03, heightRatio: 0.03,
  passKind: 'full', preprocessKind: 'raw', rotation: 0
});

const librarySheets = new Set([
  'library-entry-search',
  'library-visual-management',
  'library-template-management'
]);
const editSheets = new Set([
  'edit-basics',
  'edit-visual-source',
  'edit-required-point',
  'edit-advanced-point',
  'edit-point-management',
  'edit-trial-report',
  'edit-group-history'
]);
const knownSheets = new Set([...librarySheets, ...editSheets]);

function assertKnownSheet(sheetId) {
  if (!knownSheets.has(sheetId)) {
    throw new Error(`Unregistered inspection-drawing SOP sheet: ${sheetId}`);
  }
}

function templateForSheet(sheetId) {
  return sheetId === 'edit-group-history' ? historyTemplate : activeTemplate;
}

function summariesForSheet(sheetId) {
  return sheetId === 'library-visual-management' ? [] : [summaryTemplate];
}

async function installApiFixtures(page, sheetId, unexpectedRequests) {
  assertKnownSheet(sheetId);
  const template = templateForSheet(sheetId);
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/system/deploy-status') return route.fulfill({ json: { isMaintenance: false } });
    if (path === '/api/kiosk/config') return route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
    if (path === '/api/kiosk/call/targets') return route.fulfill({ json: { selfClientId: 'sop-generator', targets: [] } });
    if (path === '/api/kiosk/employees') return route.fulfill({ json: { employees: [] } });
    if (path === '/api/kiosk/production-schedule/resources') return route.fulfill({ json: { resources: ['R001', 'R002', 'R003'], resourceNameMap: { R001: ['旋盤1号'], R002: ['旋盤2号'] } } });
    if (path === '/api/part-measurement/inspection-drawing/templates') return route.fulfill({ json: { templates: summariesForSheet(sheetId) } });
    if (path === '/api/part-measurement/inspection-drawing/templates/sop-template-1') return route.fulfill({ json: { template } });
    if (path === '/api/part-measurement/inspection-drawing/measurement-label-settings') return route.fulfill({ json: { settings: [] } });
    if (path === '/api/part-measurement/visual-templates') return route.fulfill({ json: { visualTemplates: [visualTemplate] } });
    if (path === '/api/part-measurement/visual-templates/sop-visual-1/ocr') return route.fulfill({ json: { ocr: ocrStatus } });
    if (path === '/api/part-measurement/visual-templates/sop-visual-1/ocr/candidates') return route.fulfill({ json: { status: 'completed', candidates: [ocrCandidate], cache: ocrStatus } });
    if (path === visualTemplate.drawingImageRelativePath) return route.fulfill({ contentType: 'image/svg+xml', body: svgBody });
    unexpectedRequests.add(`${route.request().method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: `Unexpected SOP generator API request: ${path}` } });
  });
}

async function prepareSheet(page, sheetId) {
  assertKnownSheet(sheetId);
  if (sheetId === 'edit-visual-source') {
    await page.getByRole('button', { name: '図面ソースを選択' }).click();
    await page.getByRole('dialog', { name: '図面ソース選択' }).waitFor({ state: 'visible' });
    await page.locator('[data-kiosk-sop-target="pick-existing-visual"]').waitFor({ state: 'visible' });
    await page.evaluate(() => window.__clearKioskSopTimeoutsByDelay?.(400));
    await page.waitForLoadState('networkidle');
    await page.locator('[data-kiosk-sop-target="pick-existing-visual"]').waitFor({ state: 'visible' });
    await page.evaluate(() => window.__clearKioskSopTimeoutsByDelay?.(400));
  }
  if (sheetId === 'edit-advanced-point') {
    await page.getByRole('button', { name: /測定点 No\.3 / }).click();
    await page.locator('[data-kiosk-sop-target="ocr-candidate"]').waitFor({ state: 'visible' });
  }
}

function createAdapter(supportedSheets, readyTargetId) {
  const assertSupportedSheet = (sheetId) => {
    if (!supportedSheets.has(sheetId)) {
      throw new Error(`Unregistered inspection-drawing SOP sheet: ${sheetId}`);
    }
  };
  return Object.freeze({
    assertSupportedSheet,
    async waitForPageReady(page, sheetId) {
      assertSupportedSheet(sheetId);
      await page.locator(`[data-kiosk-sop-target="${readyTargetId}"]`).waitFor({ state: 'visible' });
    },
    async installApiFixtures(page, sheetId, unexpectedRequests) {
      assertSupportedSheet(sheetId);
      return installApiFixtures(page, sheetId, unexpectedRequests);
    },
    async prepareSheet(page, sheetId) {
      assertSupportedSheet(sheetId);
      return prepareSheet(page, sheetId);
    }
  });
}

const adapters = new Map([
  ['inspection-drawing-library-v1', createAdapter(librarySheets, 'inspection-navigation')],
  ['inspection-drawing-edit-v1', createAdapter(editSheets, 'template-metadata')]
]);

export function resolveInspectionDrawingCaptureAdapter(fixtureId) {
  const adapter = adapters.get(fixtureId);
  if (!adapter) throw new Error(`Unregistered inspection-drawing SOP fixture: ${fixtureId}`);
  return adapter;
}
