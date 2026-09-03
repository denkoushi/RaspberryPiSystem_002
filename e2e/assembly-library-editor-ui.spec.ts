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

const guidedCreateCapabilityGroup = {
  id: 'capability-m6-30',
  name: 'M6 30mm 標準',
  nominalDiameter: 'M6',
  boltLengthMm: '30',
  material: 'SCM435',
  strengthClass: '10.9',
  isActive: true,
  models: []
} as const;

const registeredWrenchModel = {
  id: 'registered-model',
  manufacturer: 'Test',
  modelNumber: 'TW-100',
  torqueMinNm: '1',
  torqueMaxNm: '100',
  resolutionNm: '0.01',
  communicationType: 'manual',
  outputProfile: null,
  settingVerificationMode: 'REGISTERED_SETTING',
  isActive: true
};

const registeredWrench = {
  id: 'wrench-1',
  modelId: registeredWrenchModel.id,
  serialNumber: 'SERIAL-ＡＢＣ１２３',
  model: registeredWrenchModel,
  measuringInstrument: {
    id: 'instrument-1', name: '登録レンチ', managementNumber: 'TW-1',
    storageLocation: null, calibrationExpiryDate: null, status: 'AVAILABLE'
  },
  settingHistories: [{
    id: 'setting-1', lowerLimit: '81.25', nominalTorque: '90.25', upperLimit: '99.25',
    unit: 'N·m', lowerLimitNm: '81.25', nominalTorqueNm: '90.25', upperLimitNm: '99.25',
    effectiveAt: '2026-09-01T00:00:00.000Z', reason: null
  }]
};

const registeredSettingGroup = {
  ...guidedCreateCapabilityGroup,
  models: [{ modelId: registeredWrenchModel.id, model: registeredWrenchModel }]
};

type AssemblyEditorEvidence = {
  templateBodies: Array<Record<string, unknown>>;
};

async function mockKioskApis(
  page: Page,
  deployNotice = false,
  editorEvidence?: AssemblyEditorEvidence,
  procedureDocuments: ReadonlyArray<Record<string, unknown>> = unifiedEditorDocuments,
  capabilityGroups: ReadonlyArray<Record<string, unknown>> = [guidedCreateCapabilityGroup],
  torqueWrenches: ReadonlyArray<Record<string, unknown>> = []
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
    if (path === '/api/assembly/machine-name-candidates') {
      const query = new URL(request.url()).searchParams;
      const digitQuery = query.get('digitQuery') ?? '';
      const textQuery = (query.get('q') ?? '').toUpperCase();
      const candidates = ['L300KP', 'L300KP-2', 'SH500ZX'].filter(
        (candidate) =>
          (!digitQuery || candidate.replace(/\D/g, '').includes(digitQuery)) &&
          (!textQuery || candidate.toUpperCase().includes(textQuery))
      );
      await route.fulfill({ json: { candidates, hasMore: false } });
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
      await route.fulfill({ json: { capabilityGroups } });
      return;
    }
    if (path === '/api/torque-wrench-capability-groups') {
      await route.fulfill({
        json: { capabilityGroups }
      });
      return;
    }
    if (path === '/api/torque-wrenches') {
      await route.fulfill({ json: { torqueWrenches } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

async function mockGuidedWorkflowApis(page: Page): Promise<void> {
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#e2e8f0"/><rect x="40" y="40" width="820" height="460" fill="#fff" stroke="#0f172a" stroke-width="6"/><text x="80" y="130" font-size="34" font-family="sans-serif" font-weight="700">組立手順書</text><path d="M100 340h260l100-120 150 180 170-160" fill="none" stroke="#0891b2" stroke-width="16"/></svg>';
  const imageUrl = `data:image/svg+xml,${encodeURIComponent(image)}`;
  const now = '2026-08-01T00:00:00.000Z';
  let procedureDocument: Record<string, unknown> = {
    id: 'guided-procedure-document',
    name: 'guided-procedure-document',
    imageRelativePath: imageUrl,
    status: 'draft',
    publishedAt: null,
    isActive: true,
    pages: [{ pageIndex: 0, imageRelativePath: imageUrl }],
    activeTemplateCount: 0,
    totalTemplateCount: 0,
    createdAt: now,
    updatedAt: now
  };
  let template: Record<string, unknown> | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
      await route.fulfill({ json: { selfClientId: 'assembly-guided-e2e', targets: [] } });
      return;
    }
    if (path === '/api/kiosk/employees') {
      await route.fulfill({ json: { employees: [] } });
      return;
    }
    if (path === '/api/assembly/procedure-documents/preview') {
      await route.fulfill({ contentType: 'image/svg+xml', body: image });
      return;
    }
    if (path === '/api/assembly/procedure-documents' && request.method() === 'POST') {
      procedureDocument = { ...procedureDocument, name: 'guided-procedure-document', updatedAt: now };
      await route.fulfill({ json: { document: procedureDocument } });
      return;
    }
    if (path === '/api/assembly/procedure-documents/summary') {
      await route.fulfill({ json: { documents: [{ ...procedureDocument, activeTemplateCount: template ? 1 : 0, totalTemplateCount: template ? 1 : 0 }] } });
      return;
    }
    if (path.endsWith('/publish') && path.includes('/assembly/procedure-documents/')) {
      procedureDocument = { ...procedureDocument, status: 'published', publishedAt: now, updatedAt: now };
      await route.fulfill({ json: { document: procedureDocument } });
      return;
    }
    if (path === '/api/assembly/templates/summary') {
      await route.fulfill({ json: { templates: template ? [template] : [] } });
      return;
    }
    if (path === '/api/assembly/templates' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      template = {
        id: 'guided-saved-template',
        modelCode: body.modelCode,
        procedurePattern: body.procedurePattern,
        name: body.name,
        version: 1,
        isActive: true,
        procedureDocumentId: procedureDocument.id,
        procedureDocumentName: procedureDocument.name,
        procedureItemCount: 1,
        usesLegacyProcedureSequence: false,
        areaCount: 1,
        boltCount: 1,
        createdAt: now,
        updatedAt: now
      };
      await route.fulfill({ json: { template } });
      return;
    }
    if (path === '/api/assembly/library/filter-options') {
      await route.fulfill({ json: { options: [] } });
      return;
    }
    if (path === '/api/assembly/machine-name-candidates') {
      await route.fulfill({ json: { candidates: ['L300KP'], hasMore: false } });
      return;
    }
    if (path === '/api/kiosk/assembly/templates/verify-access-password') {
      await route.fulfill({ json: { success: true } });
      return;
    }
    if (path === '/api/torque-wrench-capability-groups/compatible' || path === '/api/torque-wrench-capability-groups') {
      await route.fulfill({ json: { capabilityGroups: [guidedCreateCapabilityGroup] } });
      return;
    }
    if (path === '/api/torque-wrenches') {
      await route.fulfill({ json: { torqueWrenches: [] } });
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

async function selectAssemblyMachineName(page: Page, machineName = 'L300KP'): Promise<void> {
  const machinePicker = page.getByRole('button', { name: '機種名を選ぶ' });
  if (await machinePicker.count() === 0) {
    const panelToggle = page.getByRole('button', { name: /文書[\/・]工程/ }).first();
    if (await panelToggle.count() > 0) await panelToggle.click();
  }
  if (await page.getByRole('button', { name: '機種名を選ぶ' }).count() === 0) {
    const tab = page.getByRole('button', { name: '文書・工程', exact: true });
    if (await tab.count() > 0) await tab.click();
    const basics = page.getByText('基本設定', { exact: true });
    if (await basics.count() > 0) await basics.click();
  }
  await page.getByRole('button', { name: '機種名を選ぶ' }).click();
  const dialog = page.getByRole('dialog', { name: '機種名を選択' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('group', { name: '機種名数字テンキー' })
    .getByRole('button', { name: '3', exact: true })
    .click();
  await dialog.getByRole('textbox', { name: '機種名文字検索' }).fill('KP');
  await dialog.getByRole('button', { name: machineName, exact: true }).click();
  await dialog.getByRole('button', { name: 'この機種名を使用' }).click();
}

async function fillAssemblyTemplateStructure(page: Page): Promise<void> {
  const pane = page.locator('#assembly-procedure-pane');
  await pane.locator('#assembly-template-procedure-pattern').fill('標準');
  await expect(pane.locator('#assembly-template-name')).toHaveValue('L300KP 標準 組立');
  await pane.getByRole('button', { name: '詳細（任意）' }).click();
  await pane.locator('input[id$="-processNo"]').fill('10');
  await pane.locator('input[id$="-areaCode"]').fill('A1');
  await pane.locator('input[id$="-unitCode"]').fill('U1');
  await pane.locator('input[id$="-areaName"]').fill('本体組立');
}

async function unlockAssemblyEditor(page: Page) {
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証', exact: true }).click();
  await expect(page.getByTestId('assembly-unified-editor-workspace')).toBeVisible();
}

for (const viewport of [...viewports, { width: 900, height: 900 }]) {
  test(`assembly input guidance saves optional fields and distinguishes document additions at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const evidence: AssemblyEditorEvidence = { templateBodies: [] };
    await page.setViewportSize(viewport);
    await mockKioskApis(page, false, evidence, unifiedEditorDocuments, [registeredSettingGroup], [registeredWrench]);
    await page.goto('/kiosk/assembly/templates/new', { waitUntil: 'networkidle' });
    await unlockAssemblyEditor(page);
    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
    const header = page.getByTestId('assembly-template-editor-header');
    await expect(header.getByText('保存済み', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '詳細（任意）' }).click();
    await page.getByRole('button', { name: '詳細（任意）' }).click();
    await expect(header.getByText('保存済み', { exact: true })).toBeVisible();
    await selectAssemblyMachineName(page);
    const left = page.locator('#assembly-procedure-pane');
    await left.locator('#assembly-template-procedure-pattern').fill('標準');
    await expect(left.getByRole('button', { name: '詳細（任意）' })).toHaveAttribute('aria-expanded', 'false');
    await expect(left.locator('input[id$="-processNo"]')).toHaveCount(0);
    await expect(left).toContainText('すべての文書に共通');

    await left.getByRole('button', { name: '文書追加', exact: true }).click();
    let library = page.getByRole('dialog');
    await library.locator('li').filter({ hasText: unifiedEditorDocuments[0].name })
      .getByRole('button', { name: '文書だけ追加', exact: true }).click();
    await expect(left).toBeVisible();
    await expect(left).toContainText('未使用');
    await expect(page.getByRole('combobox', { name: 'ページ', exact: true }).locator('option:checked'))
      .toContainText(unifiedEditorDocuments[0].name);
    await page.getByRole('button', { name: '手順', exact: true }).click();
    await expect(page.getByRole('heading', { name: '手順 0/300' })).toBeVisible();
    await page.getByRole('textbox', { name: '手順検索' }).fill('存在しない手順');

    // Adding all pages must reveal only the newly added document, not auto-use the first one.
    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
    await page.getByRole('button', { name: '文書追加', exact: true }).first().click();
    library = page.getByRole('dialog');
    await library.locator('li').filter({ hasText: unifiedEditorDocuments[1].name })
      .getByRole('button', { name: /^(追加|全ページを手順へ追加)$/ }).click();
    await expect(page.getByRole('heading', { name: '手順 1/300' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '手順検索' })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'ページ', exact: true }).locator('option:checked'))
      .toContainText(unifiedEditorDocuments[1].name);

    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
    await left.locator('[id^="assembly-document-"]').filter({ hasText: unifiedEditorDocuments[0].name })
      .locator('button').first().click();
    await page.getByRole('button', { name: '全体追加', exact: true }).click();
    const image = page.getByTestId('assembly-procedure-canvas').locator('img').last();
    await image.scrollIntoViewIfNeeded();
    const box = (await image.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const right = page.getByTestId('assembly-editor-settings-pane');
    await right.getByRole('combobox', { name: '適合トルクレンチグループを検索' }).fill('M6 30mm');
    await right.getByRole('option', { name: /M6 30mm 標準/ }).click();
    await expect(right.locator('input[id$="-lowerLimit"]')).toHaveValue('81.25');
    await expect(right.locator('input[id$="-nominalTorque"]')).toHaveValue('90.25');
    await expect(right.locator('input[id$="-upperLimit"]')).toHaveValue('99.25');
    await expect(right.locator('select[id$="-unit"]')).toHaveValue('N·m');
    await expectEditorControlsFitHorizontally(right);

    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
    await left.getByRole('button', { name: '詳細（任意）' }).click();
    await left.locator('input[id$="-areaName"]').fill('一時入力');
    await left.getByRole('button', { name: '詳細（任意）' }).click();
    await left.getByRole('button', { name: '詳細（任意）' }).click();
    await expect(left.locator('input[id$="-areaName"]')).toHaveValue('一時入力');
    await left.locator('input[id$="-areaName"]').fill('');
    await expectEditorControlsFitHorizontally(left);
    await left.getByRole('button', { name: '詳細（任意）' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => evidence.templateBodies.length).toBe(1);
    const payload = evidence.templateBodies[0] as {
      areas: Array<Record<string, unknown> & { bolts: Array<Record<string, unknown>> }>;
      procedureItems: Array<{ assemblyProcedureDocumentId: string }>;
      procedureSteps: unknown[];
    };
    expect(payload.areas[0]).toMatchObject({ processNo: '', areaCode: '', unitCode: '', areaName: '' });
    expect(payload.areas[0].bolts[0]).toMatchObject({
      lowerLimit: 81.25, nominalTorque: 90.25, upperLimit: 99.25, unit: 'N·m'
    });
    expect(payload.procedureSteps).toHaveLength(2);
    expect(payload.procedureItems.map((item) => item.assemblyProcedureDocumentId))
      .toEqual(['procedure-secondary', 'procedure-primary']);
  });
}

async function fillSelectedAssemblyBolt(page: Page): Promise<void> {
  const settings = page.getByTestId('assembly-editor-settings-pane');
  const groupSearch = settings.getByRole('combobox', {
    name: '適合トルクレンチグループを検索'
  });
  await groupSearch.fill('M6 30mm');
  await settings
    .getByRole('option', { name: /M6 30mm 標準/ })
    .click();
  await settings.locator('input[id$="-lowerLimit"]').fill('9');
  await settings.locator('input[id$="-nominalTorque"]').fill('10');
  await settings.locator('input[id$="-upperLimit"]').fill('11');
  await settings.locator('select[id$="-unit"]').selectOption('N·m');
  await expect(settings).toContainText('M6 / 30mm / SCM435 / 10.9');
}

for (const viewport of [...viewports, { width: 900, height: 900 }]) {
  test(`assembly registered setting confirmation preserves partial inputs at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const profiles = [registeredWrench, {
      ...registeredWrench, id: 'unregistered-wrench', serialNumber: '未登録レンチ', settingHistories: []
    }];
    await mockKioskApis(page, false, undefined, unifiedEditorDocuments, [registeredSettingGroup], profiles);
    await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary', { waitUntil: 'networkidle' });
    await unlockAssemblyEditor(page);
    const image = page.getByTestId('assembly-procedure-canvas').locator('img').last();
    await image.scrollIntoViewIfNeeded();
    const box = (await image.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const right = page.getByTestId('assembly-editor-settings-pane');
    await right.getByRole('combobox', { name: '適合トルクレンチグループを検索' }).fill('M6 30mm');
    await right.getByRole('option', { name: /M6 30mm 標準/ }).click();
    await expect(right.locator('input[id$="-lowerLimit"]')).toHaveValue('');
    await expect(right.locator('input[id$="-nominalTorque"]')).toHaveValue('');
    await expect(right.locator('input[id$="-upperLimit"]')).toHaveValue('');
    const review = right.getByRole('button', { name: '登録設定を確認', exact: true });
    if (await review.count()) await review.click();
    await expect(right).toContainText('未登録');
    await expectEditorControlsFitHorizontally(right);
    const candidate = right.getByRole('button').filter({ hasText: '81.25' }).first();
    await expect(candidate).toContainText('TW-100');
    for (const value of ['81.25', '90.25', '99.25']) {
      const number = candidate.getByText(value, { exact: true });
      await expect(number).toBeVisible();
      expect(await number.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await expect(candidate).toContainText('N·m');
    await candidate.click();
    await expect(right.locator('input[id$="-nominalTorque"]')).toHaveValue('90.25');
    await right.locator('input[id$="-lowerLimit"]').fill('8');
    await candidate.click();
    let confirm = page.getByRole('dialog', { name: '登録設定で締付値を置き換えますか？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(right.locator('input[id$="-lowerLimit"]')).toHaveValue('8');
    await expect(right.locator('input[id$="-nominalTorque"]')).toHaveValue('90.25');
    await candidate.click();
    confirm = page.getByRole('dialog', { name: '登録設定で締付値を置き換えますか？' });
    await confirm.getByRole('button', { name: '登録設定を取り込む', exact: true }).click();
    await expect(right.locator('input[id$="-lowerLimit"]')).toHaveValue('81.25');
    await expect(right.locator('input[id$="-upperLimit"]')).toHaveValue('99.25');
    await expect(right.locator('select[id$="-unit"]')).toHaveValue('N·m');
  });
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

async function expectEditorControlsFitHorizontally(pane: Locator) {
  const clipped = await pane.evaluate((element) => {
    const problems: string[] = [];
    if (element.scrollWidth > element.clientWidth + 1) problems.push('pane scroll width');
    for (const control of element.querySelectorAll<HTMLElement>('button, input, select, textarea')) {
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const name = control.getAttribute('aria-label') || control.id || control.textContent?.trim() || control.tagName;
      const paneRect = element.getBoundingClientRect();
      if (rect.left < paneRect.left - 1 || rect.right > paneRect.right + 1) problems.push(name);
      // Check intermediate clipping ancestors too, not just the outer pane.
      for (let parent = control.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX)) {
          const parentRect = parent.getBoundingClientRect();
          const left = parentRect.left + parent.clientLeft;
          if (rect.left < left - 1 || rect.right > left + parent.clientWidth + 1) {
            problems.push(name + ' (ancestor)');
          }
        }
        if (parent === element) break;
      }
    }
    return problems;
  });
  expect(clipped).toEqual([]);
}

async function expectEditorControlReachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  const fits = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (!['hidden', 'auto', 'scroll', 'clip'].includes(getComputedStyle(parent).overflowY)) continue;
      const parentRect = parent.getBoundingClientRect();
      const top = parentRect.top + parent.clientTop;
      if (rect.top < top - 1 || rect.bottom > top + parent.clientHeight + 1) return false;
    }
    return true;
  });
  expect(fits).toBe(true);
}

for (const viewport of [...viewports, { width: 900, height: 900 }]) {
  test(`assembly editor pane fit preserves controls and stored names at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const names = [
      'M6 standard',
      '組立手順書の長い文書名と適合トルクレンチグループ名を確認する'.repeat(3),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3),
      'Ｍ６　ＡＢＣ１２３　組立用トルクレンチ'.repeat(4)
    ];
    const groups = names.map((name, index) => ({
      ...guidedCreateCapabilityGroup, id: `pane-fit-${index}`, name
    }));
    const evidence: AssemblyEditorEvidence = { templateBodies: [] };
    await page.setViewportSize(viewport);
    await mockKioskApis(page, false, evidence, [
      { ...unifiedEditorDocuments[0], name: names[1] }
    ], groups);
    await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary', { waitUntil: 'networkidle' });
    expect(pageErrors).toEqual([]);
    await expect(page.getByPlaceholder('パスワード')).toBeVisible();
    await page.getByPlaceholder('パスワード').fill('2520');
    await page.getByRole('button', { name: '認証' }).click();
    await expect(page.getByTestId('assembly-unified-editor-workspace')).toBeVisible();
    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
    await expect(page.getByRole('button', { name: '機種名を選ぶ', exact: true })).toBeVisible();
    await selectAssemblyMachineName(page);
    await fillAssemblyTemplateStructure(page);

    const left = page.locator('#assembly-procedure-pane');
    const documentCard = left.locator('[id^="assembly-document-"]').first();
    await documentCard.getByRole('button', { name: '表示名を変更' }).click();
    const labelInput = documentCard.getByLabel('表示ラベル');
    let shortCardHeight = 0;
    for (const [index, name] of names.entries()) {
      await labelInput.fill(name);
      await expect(labelInput).toHaveValue(name);
      await expect(documentCard.locator('span[title]').first()).toHaveAttribute('title', name);
      await expectEditorControlsFitHorizontally(left);
      const height = (await documentCard.boundingBox())!.height;
      if (index === 0) shortCardHeight = height;
      else expect(height).toBeCloseTo(shortCardHeight, 0);
    }
    await expect(documentCard.locator('span[title]').first()).toContainText('M6 ABC123');
    await left.locator('input[id$="-processNo"]').fill('12345678901234567890');
    const areaButton = left.getByRole('button').filter({ hasText: '12345678901234567890-A1' });
    await expect(areaButton.getByText('未完了', { exact: true })).toBeVisible();
    await expectEditorControlsFitHorizontally(left);
    await left.locator('input[id$="-processNo"]').fill('10');

    const canvas = page.getByTestId('assembly-procedure-canvas');
    const image = canvas.locator('img').last();
    await image.scrollIntoViewIfNeeded();
    let box = (await image.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const right = page.getByTestId('assembly-editor-settings-pane');
    await expect(right).toBeVisible();
    if (viewport.width >= 1280) {
      expect((await left.locator('xpath=ancestor::aside').boundingBox())!.width).toBe(256);
      expect((await right.boundingBox())!.width).toBe(320);
    }
    const centralWidth = (await page.getByTestId('assembly-unified-editor-canvas-pane').boundingBox())!.width;
    const groupSearch = right.getByRole('combobox', { name: '適合トルクレンチグループを検索' });
    let shortGroupHeight = 0;
    for (const [index, group] of groups.entries()) {
      await groupSearch.fill('');
      if (await groupSearch.getAttribute('aria-expanded') !== 'true') {
        await right.getByRole('button', { name: '適合トルクレンチグループを検索の候補を表示', exact: true }).click();
      }
      const option = right.getByRole('option').filter({ hasText: group.name });
      await expectEditorControlsFitHorizontally(right);
      await expectEditorControlReachable(option);
      await option.click();
      const selectedName = right.locator('div[title]').filter({ hasText: index === 3 ? 'M6 ABC123' : group.name });
      await expect(selectedName).toHaveAttribute('title', group.name);
      const height = (await selectedName.locator('..').boundingBox())!.height;
      if (index === 0) shortGroupHeight = height;
      else expect(height).toBeCloseTo(shortGroupHeight, 0);
      await expectEditorControlsFitHorizontally(right);
    }
    for (const [field, value] of [['lowerLimit', '81.25'], ['nominalTorque', '90.25'], ['upperLimit', '99.25']]) {
      const input = right.locator(`input[id$="-${field}"]`);
      await input.fill(value);
      await expect(input).toHaveValue(value);
      const fits = await input.evaluate((element) => element.scrollWidth <= element.clientWidth);
      expect(fits).toBe(true);
    }
    await right.locator('select[id$="-unit"]').selectOption('kgf·cm');
    await expectEditorControlReachable(right.locator('select[id$="-unit"]'));
    await right.locator('select[id$="-unit"]').selectOption('N·m');
    await right.getByRole('button', { name: '条件を一括反映', exact: true }).click();
    await expectEditorControlsFitHorizontally(right);
    await expectEditorControlReachable(right.getByRole('button', { name: '条件反映', exact: true }));
    await right.getByRole('button', { name: '条件を一括反映', exact: true }).click();
    await right.getByRole('button', { name: '表示名を個別指定', exact: true }).click();
    await right.locator('input[id$="-boltSpecCustom"]').fill(names[2]);
    await expectEditorControlsFitHorizontally(right);
    const restoreSpec = right.getByRole('button', { name: '自動生成へ戻す' });
    await expectEditorControlReachable(restoreSpec);
    await restoreSpec.click();

    await page.getByRole('button', { name: '手順', exact: true }).click();
    const storyboard = page.getByTestId('assembly-step-storyboard');
    await expectEditorControlsFitHorizontally(storyboard);
    await page.getByRole('button', { name: '手順設定', exact: true }).click();
    await expect(right.getByText('P1 · 全体', { exact: true })).toBeVisible();
    await expectEditorControlsFitHorizontally(right);
    await right.getByLabel('タイトル', { exact: true }).fill(names[3]);
    await right.getByLabel(/^指示文/).fill('ＡＢＣ１２３は保存時に変換しない。');
    await right.getByRole('button', { name: '⚠ 注意' }).click();

    await page.getByRole('button', { name: '矩形追加', exact: true }).click();
    await image.scrollIntoViewIfNeeded();
    box = (await image.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8);
    await page.mouse.up();
    await expect(right.getByText('P1 · 矩形', { exact: true })).toBeVisible();
    await expectEditorControlsFitHorizontally(right);
    const cropRight = right.getByRole('group', { name: '矩形位置の微調整' }).getByRole('button', { name: '→', exact: true });
    await expectEditorControlReachable(cropRight);
    await cropRight.click();
    await right.getByRole('button', { name: '全体を一時表示' }).click();
    await right.getByRole('button', { name: '矩形へ戻る' }).click();
    await page.getByRole('button', { name: 'チェックマーカー', exact: true }).click();
    await page.getByRole('button', { name: '丸数字', exact: true }).click();
    const crop = page.getByTestId('assembly-unified-editor-canvas-pane').getByTestId('assembly-procedure-crop-view');
    await crop.scrollIntoViewIfNeeded();
    box = (await crop.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await right.getByLabel('ラベル', { exact: true }).fill('目視確認');
    await expectEditorControlsFitHorizontally(right);
    await expectEditorControlReachable(right.getByRole('checkbox'));
    expect((await page.getByTestId('assembly-unified-editor-canvas-pane').boundingBox())!.width).toBeCloseTo(centralWidth, 0);

    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => evidence.templateBodies.length).toBe(1);
    expect(evidence.templateBodies[0]).toMatchObject({
      procedureItems: [{ label: names[3] }],
      areas: [{ bolts: [{ lowerLimit: 81.25, nominalTorque: 90.25, upperLimit: 99.25, unit: 'N·m', capabilityGroupId: groups[3].id }] }],
      procedureSteps: [{ title: names[3], instructionText: 'ＡＢＣ１２３は保存時に変換しない。', emphasis: 'caution' }, {}],
      checkItems: [{ label: '目視確認' }]
    });
  });
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
    await expect(page.locator('#assembly-procedure-pane')).toBeVisible();
    await expect(page.getByTestId('assembly-editor-settings-pane')).toHaveCount(0);
    await expectDirectChildrenOnOneRow(toolbar);

    const header = page.getByTestId('assembly-template-editor-header');
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.height).toBeLessThanOrEqual(56);
    await expectDirectChildrenOnOneRow(header);
    await expect(page.getByTestId('assembly-template-creation-guide')).toHaveCount(0);

    const initialRatio = await workspace.evaluate((element) => {
      const canvas = element.querySelector<HTMLElement>('[data-testid="assembly-unified-editor-canvas-pane"]');
      return canvas ? canvas.getBoundingClientRect().width / element.getBoundingClientRect().width : 0;
    });
    expect(initialRatio).toBeGreaterThanOrEqual(0.75);

    const image = canvasPane.locator('img').last();
    await expect(image).toBeVisible();
    const beforeOverlay = await Promise.all([
      workspace.boundingBox(),
      canvasPane.boundingBox(),
      image.boundingBox()
    ]);
    await page.getByRole('button', { name: /未完了 \d+件/ }).click();
    await expect(page.getByRole('dialog', { name: 'テンプレートの未完了項目' })).toBeVisible();
    const afterOverlay = await Promise.all([
      workspace.boundingBox(),
      canvasPane.boundingBox(),
      image.boundingBox()
    ]);
    expect(afterOverlay).toEqual(beforeOverlay);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '文書/工程', exact: true }).click();
    const oneDocumentRatio = await workspace.evaluate((element) => {
      const canvas = element.querySelector<HTMLElement>('[data-testid="assembly-unified-editor-canvas-pane"]');
      return canvas ? canvas.getBoundingClientRect().width / element.getBoundingClientRect().width : 0;
    });
    expect(oneDocumentRatio).toBeGreaterThanOrEqual(0.75);

    await page.getByRole('button', { name: '文書/工程', exact: true }).click();
    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
    await page.getByRole('button', { name: '文書追加' }).click();
    const dialog = page.getByRole('dialog', { name: '文書ライブラリ' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('listitem')
      .filter({ hasText: '統合エディター 補助手順書' })
      .getByLabel('追加', { exact: true })
      .click();
    await expect(page.getByRole('heading', { name: '手順 2/300' })).toBeVisible();
    await page.getByRole('button', { name: '文書・工程', exact: true }).click();
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
    await expect(page.locator('th', { hasText: '機種名' }).first()).toBeVisible();

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
    await expect(canvas.locator('button[title^="P7-A13"]')).toHaveCount(2);
    await expect(canvas.getByRole('button', { name: '丸数字3' })).toBeVisible();

    await page.getByRole('button', { name: '作業画面表示' }).click();
    const workImage = page.getByTestId('assembly-procedure-image-with-markers');
    await expect(workImage).toBeVisible();
    await expect(workImage.locator('svg line')).toHaveCount(2);
    await expect(workImage.locator('button[title^="P7-A13"]')).toHaveCount(2);
    await expect(workImage.getByRole('button', { name: '丸数字3' })).toBeVisible();
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

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 900, height: 900 }
]) {
  test(`guided assembly template creates a complete draft without hidden defaults at ${viewport.width}x${viewport.height}`, async ({
    page
  }) => {
    const evidence: AssemblyEditorEvidence = { templateBodies: [] };
    await page.setViewportSize(viewport);
    await mockKioskApis(page, false, evidence);
    await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary', {
      waitUntil: 'networkidle'
    });
    await page.getByPlaceholder('パスワード').fill('2520');
    await page.getByRole('button', { name: '認証' }).click();

    const saveButton = page.getByRole('button', { name: '保存', exact: true });
    await expect(saveButton).toBeDisabled();
    await expect(page.getByText('旧形式を取込')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /文書を上へ/ })).toHaveCount(0);
    await selectAssemblyMachineName(page);
    await fillAssemblyTemplateStructure(page);
    await expect(page.getByText('L300KP', { exact: true })).toBeVisible();

    const canvas = page.getByTestId('assembly-procedure-canvas');
    const image = canvas.locator('img').last();
    await expect(image).toBeVisible();
    await image.scrollIntoViewIfNeeded();
    const imageBox = await image.boundingBox();
    expect(imageBox).not.toBeNull();
    await page.mouse.click(
      imageBox!.x + imageBox!.width * 0.5,
      imageBox!.y + imageBox!.height * 0.5
    );
    await expect(canvas.getByRole('button', { name: '丸数字1' })).toBeVisible();
    await fillSelectedAssemblyBolt(page);
    await expect(page.getByTestId('assembly-editor-settings-pane')).toContainText(
      'M6×30 / SCM435 / 10.9'
    );

    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect.poll(() => evidence.templateBodies.length).toBe(1);
    const payload = evidence.templateBodies[0] as {
      modelCode: string;
      procedurePattern: string;
      name: string;
      areas: Array<{
        processNo: string;
        bolts: Array<{
          boltSpec: string;
          boltLengthMm: number | null;
          nominalTorque: number | null;
          capabilityGroupId: string | null;
        }>;
      }>;
    };
    expect(payload).toMatchObject({
      modelCode: 'L300KP',
      procedurePattern: '標準',
      name: 'L300KP 標準 組立'
    });
    expect(payload.areas[0]).toMatchObject({ processNo: '10' });
    expect(payload.areas[0]!.bolts[0]).toMatchObject({
      boltSpec: 'M6×30 / SCM435 / 10.9',
      boltLengthMm: 30,
      nominalTorque: 10,
      capabilityGroupId: guidedCreateCapabilityGroup.id
    });

    const pageOverflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.clientWidth + 1);
  });
}

test('direct new assembly-template URL does not select a document implicitly', async ({
  page
}) => {
  await mockKioskApis(page);
  await page.goto('/kiosk/assembly/templates/new', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();

  await expect(page.getByRole('heading', { name: '使用文書' })).toBeVisible();
  await expect(page.getByText('統合エディター 主手順書')).toHaveCount(0);
  await expect(page.getByTestId('assembly-procedure-canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
});

test('guided assembly workflow moves from preview to publish, create, save, and highlighted library row', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mockGuidedWorkflowApis(page);
  await page.goto('/kiosk/assembly/library', { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: 'ファイルから登録' }).click();
  const uploadDialog = page.getByRole('dialog', { name: '手順書を登録' });
  await expect(uploadDialog).toBeVisible();
  await uploadDialog.locator('input[type="file"]').setInputFiles({
    name: 'guided-procedure.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#fff"/></svg>')
  });
  await uploadDialog.getByRole('button', { name: '先頭ページを確認' }).click();
  await expect(uploadDialog.getByAltText('手順書の先頭ページプレビュー')).toBeVisible();
  await uploadDialog.getByRole('button', { name: '下書きとして登録' }).click();

  const previewDialog = page.getByRole('dialog', { name: /手順書の内容確認/ });
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog.getByText('1ページ目')).toBeVisible();
  await previewDialog.getByLabel('手順書公開の管理パスワード').fill('2520');
  await previewDialog.getByRole('button', { name: '確認して公開' }).click();
  await expect(previewDialog.getByRole('button', { name: 'この手順書でテンプレートを新規作成' })).toBeVisible();
  await previewDialog.getByRole('button', { name: 'この手順書でテンプレートを新規作成' }).click();

  await expect(page).toHaveURL(/\/kiosk\/assembly\/templates\/new\?procedureDocumentId=guided-procedure-document/);
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  await selectAssemblyMachineName(page);
  await fillAssemblyTemplateStructure(page);
  const canvas = page.getByTestId('assembly-procedure-canvas');
  const image = canvas.locator('img').last();
  await expect(image).toBeVisible();
  const imageBox = await image.boundingBox();
  expect(imageBox).not.toBeNull();
  await page.mouse.click(imageBox!.x + imageBox!.width * 0.5, imageBox!.y + imageBox!.height * 0.5);
  await fillSelectedAssemblyBolt(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();

  await expect(page).toHaveURL(/\/kiosk\/assembly\/library\?focus=templates&modelCode=L300KP/);
  await expect(page.getByText('テンプレート L300KP \/ 標準 v1 を保存しました。')).toBeVisible();
  const highlighted = page.locator('[data-template-id="guided-saved-template"]');
  await expect(highlighted).toBeVisible();
  await expect(highlighted).toHaveClass(/bg-emerald-500/);
});

test('assembly editor restores and discards debounced browser recovery', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mockKioskApis(page);
  const editorUrl = '/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary';
  await page.goto(editorUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  await selectAssemblyMachineName(page);
  const pattern = page.locator('#assembly-template-procedure-pattern');
  await pattern.fill('復元対象');
  await page.waitForTimeout(1_000);
  const recoveryKey = await page.evaluate(() => Object.keys(localStorage).find((key) => key.includes('assembly-template-editor-recovery:v1')));
  expect(recoveryKey).toBeTruthy();

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  const recoveryDialog = page.getByRole('dialog', { name: '途中内容を復元しますか？' });
  await expect(recoveryDialog).toBeVisible();
  await recoveryDialog.getByRole('button', { name: '途中内容を復元' }).click();
  await expect(page.locator('#assembly-template-procedure-pattern')).toHaveValue('復元対象');

  await page.locator('#assembly-template-procedure-pattern').fill('破棄対象');
  await page.waitForTimeout(1_000);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  await page.getByRole('dialog', { name: '途中内容を復元しますか？' }).getByRole('button', { name: '破棄' }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.includes('assembly-template-editor-recovery:v1')))).toBe(false);
});

test('unified assembly editor stacks panels and keeps touch targets usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await mockKioskApis(page);
  await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=procedure-primary', {
    waitUntil: 'networkidle'
  });

  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();

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
  await page.getByRole('button', { name: '文書・工程', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '基本設定', exact: true })
  ).toBeVisible();
  await selectAssemblyMachineName(page);
  await fillAssemblyTemplateStructure(page);
  await page.getByRole('button', { name: '手順', exact: true }).click();

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

  const canvas = page.getByTestId('assembly-procedure-canvas');
  const sourceImage = canvas.locator('img').last();
  await expect(sourceImage).toBeVisible();
  const imageBox = await sourceImage.boundingBox();
  expect(imageBox).not.toBeNull();
  await page.mouse.click(
    imageBox!.x + imageBox!.width * 0.4,
    imageBox!.y + imageBox!.height * 0.5
  );
  const sharedBolt = canvas.getByRole('button', { name: '丸数字1' });
  await expect(sharedBolt).toBeVisible();
  const resizedImageBox = await sourceImage.boundingBox();
  expect(resizedImageBox).not.toBeNull();
  await page.getByRole('button', { name: '矢視', exact: true }).click();
  await page.mouse.click(
    resizedImageBox!.x + resizedImageBox!.width * 0.7,
    resizedImageBox!.y + resizedImageBox!.height * 0.5
  );
  await expect(canvas.locator('svg line')).toHaveCount(1);

  await page.getByRole('button', { name: '矩形追加', exact: true }).click();
  await page.mouse.move(
    resizedImageBox!.x + resizedImageBox!.width * 0.2,
    resizedImageBox!.y + resizedImageBox!.height * 0.25
  );
  await page.mouse.down();
  await page.mouse.move(
    resizedImageBox!.x + resizedImageBox!.width * 0.8,
    resizedImageBox!.y + resizedImageBox!.height * 0.75
  );
  await page.mouse.up();

  await expect(
    page
      .getByTestId('assembly-unified-editor-canvas-pane')
      .getByTestId('assembly-procedure-crop-view')
  ).toBeVisible();
  const cropView = page
    .getByTestId('assembly-unified-editor-canvas-pane')
    .getByTestId('assembly-procedure-crop-view');
  await expect(cropView.locator('[data-marker-id]')).toHaveCount(1);
  await expect(cropView.locator('svg line')).toHaveCount(1);
  await expect(page.getByTestId('assembly-procedure-crop-minimap')).toBeVisible();
  await page.getByLabel('タイトル').fill('重点締付');
  await page.getByLabel('指示文').fill('赤線の内側を先に締める');
  await page.getByRole('button', { name: '⚠ 注意' }).click();
  await expect(storyboard.locator('article')).toHaveCount(3);

  const selectedCropCard = storyboard
    .locator('article')
    .filter({ hasText: '重点締付' });
  await expect(selectedCropCard.locator('[data-marker-id]')).toHaveCount(1);
  await expect(selectedCropCard.locator('svg line')).toHaveCount(1);

  const cropBox = await cropView.boundingBox();
  expect(cropBox).not.toBeNull();
  await page.getByRole('button', { name: 'チェックマーカー' }).click();
  await page.getByRole('button', { name: '丸数字', exact: true }).click();
  await page.mouse.click(
    cropBox!.x + cropBox!.width * 0.25,
    cropBox!.y + cropBox!.height * 0.25
  );
  await expect(cropView.getByRole('button', { name: 'チェック1' })).toBeVisible();
  await page.getByRole('button', { name: '矢視', exact: true }).click();
  const checkCalloutCropBox = await cropView.boundingBox();
  expect(checkCalloutCropBox).not.toBeNull();
  await page.mouse.click(
    checkCalloutCropBox!.x + checkCalloutCropBox!.width * 0.45,
    checkCalloutCropBox!.y + checkCalloutCropBox!.height * 0.25
  );

  await page.getByRole('button', { name: '締結マーカー' }).click();
  await page.getByRole('button', { name: '丸数字', exact: true }).click();
  const boltMarkerCropBox = await cropView.boundingBox();
  expect(boltMarkerCropBox).not.toBeNull();
  await page.mouse.click(
    boltMarkerCropBox!.x + boltMarkerCropBox!.width * 0.6,
    boltMarkerCropBox!.y + boltMarkerCropBox!.height * 0.6
  );
  await expect(cropView.getByRole('button', { name: /^丸数字/ })).toHaveCount(2);
  await page.getByRole('button', { name: '矢視', exact: true }).click();
  const boltCalloutCropBox = await cropView.boundingBox();
  expect(boltCalloutCropBox).not.toBeNull();
  await page.mouse.click(
    boltCalloutCropBox!.x + boltCalloutCropBox!.width * 0.75,
    boltCalloutCropBox!.y + boltCalloutCropBox!.height * 0.6
  );
  await expect(cropView.locator('svg line')).toHaveCount(3);

  await page.getByRole('button', { name: '丸数字', exact: true }).click();
  const removableMarkerCropBox = await cropView.boundingBox();
  expect(removableMarkerCropBox).not.toBeNull();
  await page.mouse.click(
    removableMarkerCropBox!.x + removableMarkerCropBox!.width * 0.5,
    removableMarkerCropBox!.y + removableMarkerCropBox!.height * 0.8
  );
  await expect(cropView.getByRole('button', { name: /^丸数字/ })).toHaveCount(3);
  const settingsPane = page.getByTestId('assembly-editor-settings-pane');
  await settingsPane.getByRole('button', { name: '削除', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: /丸数字.*を削除/ });
  await expect(deleteDialog).toContainText('全体・矩形2件から削除');
  await deleteDialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(cropView.getByRole('button', { name: /^丸数字/ })).toHaveCount(3);
  await settingsPane.getByRole('button', { name: '削除', exact: true }).click();
  await deleteDialog.getByRole('button', { name: 'すべてから削除' }).click();
  await expect(cropView.getByRole('button', { name: /^丸数字/ })).toHaveCount(2);

  await expect(settingsPane).toHaveCount(0);
  await page.getByRole('button', { name: '手順設定' }).click();
  await page.getByRole('button', { name: '全体を一時表示' }).click();
  const fullPageView = page.getByTestId('assembly-procedure-canvas');
  await expect(fullPageView.getByRole('button', { name: /^丸数字/ })).toHaveCount(2);
  await expect(fullPageView.getByRole('button', { name: 'チェック1' })).toBeVisible();
  await expect(fullPageView.locator('svg line')).toHaveCount(3);
  await page.getByRole('button', { name: '矩形へ戻る' }).click();

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

  for (const markerName of ['丸数字1', '丸数字2']) {
    await cropView.getByRole('button', { name: markerName }).click();
    await fillSelectedAssemblyBolt(page);
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => evidence.templateBodies.length).toBe(1);
  const payload = evidence.templateBodies[0] as {
    procedureDocumentId: string;
    procedureItems: Array<{ assemblyProcedureDocumentId: string | null }>;
    areas: Array<{
      bolts: Array<{
        xRatio: number;
        yRatio: number;
        calloutTipXRatio: number | null;
        calloutTipYRatio: number | null;
      }>;
    }>;
    checkItems: Array<{
      xRatio: number;
      yRatio: number;
      calloutTipXRatio: number | null;
      calloutTipYRatio: number | null;
    }>;
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
  expect(payload.areas[0]!.bolts).toHaveLength(2);
  expect(payload.areas[0]!.bolts[0]!.xRatio).toBeCloseTo(0.4, 2);
  expect(payload.areas[0]!.bolts[0]!.yRatio).toBeCloseTo(0.5, 2);
  expect(payload.areas[0]!.bolts[0]!.calloutTipXRatio).toBeCloseTo(0.7, 2);
  expect(payload.areas[0]!.bolts[0]!.calloutTipYRatio).toBeCloseTo(0.5, 2);
  expect(payload.areas[0]!.bolts[1]!.xRatio).toBeCloseTo(0.56, 2);
  expect(payload.areas[0]!.bolts[1]!.yRatio).toBeCloseTo(0.55, 2);
  expect(payload.areas[0]!.bolts[1]!.calloutTipXRatio).toBeCloseTo(0.65, 2);
  expect(payload.areas[0]!.bolts[1]!.calloutTipYRatio).toBeCloseTo(0.55, 2);
  expect(payload.checkItems[0]!.xRatio).toBeCloseTo(0.35, 2);
  expect(payload.checkItems[0]!.yRatio).toBeCloseTo(0.375, 2);
  expect(payload.checkItems[0]!.calloutTipXRatio).toBeCloseTo(0.47, 2);
  expect(payload.checkItems[0]!.calloutTipYRatio).toBeCloseTo(0.375, 2);
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
  await page.getByRole('button', { name: '手順', exact: true }).click();
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
