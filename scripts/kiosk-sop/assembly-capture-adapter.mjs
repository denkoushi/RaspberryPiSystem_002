const procedureDocument = Object.freeze({
  id: 'sop-procedure-1',
  name: '組立手順書 SOP Fixture',
  imageRelativePath: '/api/storage/assembly-procedure-documents/sop-procedure-1/page-1.jpg',
  status: 'published',
  publishedAt: '2026-08-01T00:00:00.000Z',
  isActive: true,
  pages: [
    { pageIndex: 0, imageRelativePath: '/api/storage/assembly-procedure-documents/sop-procedure-1/page-1.jpg' }
  ],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
});

const fixtureImage = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">' +
    '<rect width="960" height="540" fill="#e2e8f0"/>' +
    '<rect x="48" y="42" width="864" height="456" rx="12" fill="#ffffff" stroke="#0f172a" stroke-width="4"/>' +
    '<text x="80" y="115" fill="#0f172a" font-family="sans-serif" font-size="32" font-weight="700">組立手順書 Fixture</text>' +
    '<text x="80" y="170" fill="#334155" font-family="sans-serif" font-size="24">手順 1  部品を確認して締結する</text>' +
    '<path d="M110 300h300l70-70 150 150 120-110 130 130" fill="none" stroke="#0891b2" stroke-width="14"/>' +
    '<circle cx="410" cy="300" r="22" fill="#f59e0b"/><circle cx="630" cy="380" r="22" fill="#22c55e"/>' +
  '</svg>'
);

const procedureSummary = Object.freeze({
  ...procedureDocument,
  activeTemplateCount: 1,
  totalTemplateCount: 1
});

const templateSummary = Object.freeze({
  id: 'sop-template-1',
  modelCode: 'MODEL-SOP',
  procedurePattern: '標準組立',
  name: 'MODEL-SOP 標準組立',
  version: 2,
  isActive: true,
  procedureDocumentId: procedureDocument.id,
  procedureDocumentName: procedureDocument.name,
  procedureItemCount: 1,
  usesLegacyProcedureSequence: false,
  areaCount: 1,
  boltCount: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
});

const sheets = new Set([
  'assembly-overview',
  'assembly-file-register',
  'assembly-gmail-publish',
  'assembly-revision',
  'assembly-template-auth-basics',
  'assembly-template-procedure',
  'assembly-template-markers',
  'assembly-template-save'
]);

function assertSupportedSheet(sheetId) {
  if (!sheets.has(sheetId)) throw new Error(`Unregistered assembly SOP sheet: ${sheetId}`);
}

function json(route, payload) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
}

async function installApiFixtures(page, sheetId, unexpectedRequests) {
  assertSupportedSheet(sheetId);
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/system/deploy-status') return json(route, { isMaintenance: false });
    if (path === '/api/kiosk/config') return json(route, { defaultMode: 'tag', clientStatus: null });
    if (path === '/api/kiosk/call/targets') return json(route, { selfClientId: 'sop-generator', targets: [] });
    if (path === '/api/kiosk/employees') return json(route, { employees: [] });
    if (path === '/api/kiosk/production-schedule/resources') return json(route, { resources: [], resourceNameMap: {} });
    if (path === '/api/assembly/procedure-documents/preview' && request.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fixtureImage });
    }
    if (path === '/api/assembly/procedure-documents' && request.method() === 'POST') {
      return json(route, {
        document: {
          ...procedureDocument,
          id: 'sop-procedure-uploaded',
          name: '組立手順書 Fixture（登録済み）',
          status: 'draft',
          publishedAt: null,
          pages: [{ pageIndex: 0, imageRelativePath: procedureDocument.imageRelativePath }]
        }
      });
    }
    if (path === '/api/assembly/procedure-documents/summary') return json(route, { documents: [procedureSummary] });
    if (path === '/api/assembly/templates/summary') return json(route, { templates: [templateSummary] });
    if (path === '/api/assembly/library/filter-options') return json(route, { options: [] });
    if (path === '/api/torque-wrench-capability-groups') return json(route, { capabilityGroups: [] });
    if (path === '/api/kiosk/assembly/templates/verify-access-password') return json(route, { success: true });
    if (path.endsWith('/sop-procedure-1/page-1.jpg')) {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fixtureImage });
    }
    unexpectedRequests.add(`${request.method()} ${path}`);
    return json(route, { message: `Unexpected SOP generator API request: ${path}` });
  });
}

async function prepareSheet(page, sheetId) {
  assertSupportedSheet(sheetId);
  if (sheetId === 'assembly-file-register') {
    await page.locator('[data-kiosk-sop-target="assembly-file-register"]').click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'assembly-guide.svg',
      mimeType: 'image/svg+xml',
      buffer: fixtureImage
    });
    await page.locator('[data-kiosk-sop-target="assembly-procedure-preview-file"]').click();
    await page.locator('img[alt="手順書の先頭ページプレビュー"]').waitFor({ state: 'visible' });
    return;
  }
  if (sheetId === 'assembly-gmail-publish') {
    await page.locator('[data-kiosk-sop-target="assembly-gmail-import"]').click();
    await page.locator('[data-kiosk-sop-target="assembly-gmail-confirm"]').waitFor({ state: 'visible' });
    return;
  }
  if (sheetId.startsWith('assembly-template-')) {
    await page.locator('[data-kiosk-sop-target="assembly-editor-password"]').fill('0000');
    await page.locator('[data-kiosk-sop-target="assembly-editor-authenticate"]').click();
    const target = sheetId === 'assembly-template-auth-basics'
      ? 'assembly-editor-model-code'
      : sheetId === 'assembly-template-procedure'
        ? 'assembly-editor-document-add'
        : sheetId === 'assembly-template-markers'
          ? 'assembly-editor-area-add'
          : 'assembly-editor-save';
    await page.locator(`[data-kiosk-sop-target="${target}"]`).waitFor({ state: 'visible' });
    if (sheetId === 'assembly-template-markers') {
      await page.locator(`[data-kiosk-sop-target="${target}"]`).scrollIntoViewIfNeeded();
    }
  }
}

const adapter = Object.freeze({
  assertSupportedSheet,
  installApiFixtures,
  prepareSheet,
  async waitForPageReady(page, sheetId) {
    assertSupportedSheet(sheetId);
    const target = sheetId.startsWith('assembly-template-')
      ? 'assembly-editor-authenticate'
      : sheetId === 'assembly-revision'
        ? 'assembly-template-revise'
        : sheetId === 'assembly-gmail-publish'
          ? 'assembly-gmail-import'
          : sheetId === 'assembly-file-register'
            ? 'assembly-file-register'
        : sheetId === 'assembly-template-procedure'
          ? 'assembly-editor-document-add'
          : sheetId === 'assembly-template-markers'
            ? 'assembly-editor-area-add'
            : sheetId === 'assembly-template-save'
              ? 'assembly-editor-save'
              : sheetId === 'assembly-overview'
                ? 'assembly-library-refresh'
                : 'assembly-file-register';
    await page.locator(`[data-kiosk-sop-target="${target}"]`).waitFor({ state: 'visible' });
  }
});

export function resolveAssemblyCaptureAdapter(fixtureId) {
  if (fixtureId !== 'assembly-library-v1' && fixtureId !== 'assembly-editor-v1') {
    throw new Error(`Unregistered assembly SOP fixture: ${fixtureId}`);
  }
  return adapter;
}
