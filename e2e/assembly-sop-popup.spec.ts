import { expect, test, type Page } from '@playwright/test';

const procedureImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="540"%3E%3Crect width="900" height="540" fill="%23e2e8f0"/%3E%3Crect x="40" y="40" width="820" height="460" fill="%23fff" stroke="%230f172a" stroke-width="6"/%3E%3C/svg%3E';

const procedureDocument = {
  id: 'sop-procedure-1',
  name: 'SOP用組立手順書',
  imageRelativePath: procedureImage,
  status: 'published',
  publishedAt: '2026-08-01T00:00:00.000Z',
  isActive: true,
  pages: [{ pageIndex: 0, imageRelativePath: procedureImage }],
  activeTemplateCount: 0,
  totalTemplateCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
};

async function installAssemblySopApiMocks(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/src/api/')) {
      await route.continue();
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
      await route.fulfill({ json: { selfClientId: 'assembly-sop-e2e', targets: [] } });
      return;
    }
    if (path.includes('/kiosk/employees')) {
      await route.fulfill({ json: { employees: [] } });
      return;
    }
    if (path.includes('/assembly/procedure-documents/summary')) {
      await route.fulfill({ json: { documents: [procedureDocument] } });
      return;
    }
    if (path.includes('/assembly/templates/summary')) {
      await route.fulfill({ json: { templates: [] } });
      return;
    }
    if (path.includes('/assembly/library/filter-options')) {
      await route.fulfill({ json: { options: [] } });
      return;
    }
    if (path.includes('/assembly/machine-name-candidates')) {
      await route.fulfill({ json: { candidates: ['L300KP'], hasMore: false } });
      return;
    }
    if (path.includes('/kiosk/assembly/templates/verify-access-password')) {
      await route.fulfill({ json: { success: true } });
      return;
    }
    if (path.includes('/torque-wrench-capability-groups')) {
      await route.fulfill({ json: { capabilityGroups: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test('assembly SOP opens at the correct sheets, navigates safely, and stays offline', async ({
  page,
  context
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installAssemblySopApiMocks(page);
  await page.goto('/kiosk/assembly/library', { waitUntil: 'domcontentloaded' });
  const managementLauncher = page.getByRole('button', { name: 'この画面の操作手順を開く' });
  await expect(managementLauncher).toBeVisible();

  const iframeRequests: string[] = [];
  page.on('request', (request) => {
    if (request.frame().parentFrame()) iframeRequests.push(request.url());
  });

  await context.setOffline(true);
  try {
    await managementLauncher.click();
    const frameElement = page.getByTestId('kiosk-sop-frame');
    await expect(frameElement).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(frameElement).toHaveAttribute('referrerpolicy', 'no-referrer');
    const frame = page.frameLocator('[data-testid="kiosk-sop-frame"]');
    await expect(frame.locator('.sheet[data-sheet="assembly-overview"]')).toBeVisible();
    await page.getByRole('button', { name: '次の手順' }).click();
    await expect(frame.locator('.sheet[data-sheet="assembly-file-register"]')).toBeVisible();
    await page.getByRole('button', { name: '前の手順' }).click();
    await expect(frame.locator('.sheet[data-sheet="assembly-overview"]')).toBeVisible();
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(managementLauncher).toBeFocused();

    await managementLauncher.click();
    await frame.locator('body').press('Escape');
    await expect(frameElement).toBeHidden();
    await expect(managementLauncher).toBeFocused();
  } finally {
    await context.setOffline(false);
  }
  expect(iframeRequests).toEqual([]);

  await page.goto('/kiosk/assembly/templates/new?procedureDocumentId=sop-procedure-1', {
    waitUntil: 'domcontentloaded'
  });
  const authLauncher = page.getByRole('button', { name: 'この画面の操作手順を開く' });
  await authLauncher.click();
  const authFrame = page.frameLocator('[data-testid="kiosk-sop-frame"]');
  await expect(authFrame.locator('.sheet[data-sheet="assembly-template-auth-basics"]')).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();

  await page.getByPlaceholder('パスワード').fill('2520');
  await page.getByRole('button', { name: '認証' }).click();
  const editorLauncher = page.getByRole('button', { name: 'この画面の操作手順を開く' });
  await editorLauncher.click();
  await expect(page.frameLocator('[data-testid="kiosk-sop-frame"]').locator('.sheet[data-sheet="assembly-template-auth-basics"]')).toBeVisible();

  await page.getByRole('button', { name: '閉じる' }).click();
  await page.goto('/kiosk/assembly/templates/sop-template-1/edit', {
    waitUntil: 'domcontentloaded'
  });
  const revisionLauncher = page.getByRole('button', { name: 'この画面の操作手順を開く' });
  await revisionLauncher.click();
  await expect(page.frameLocator('[data-testid="kiosk-sop-frame"]').locator('.sheet[data-sheet="assembly-revision"]')).toBeVisible();
});
