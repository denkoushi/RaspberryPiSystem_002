import { test, expect } from '@playwright/test';

/**
 * 修正版 Web（ローカル dev）で図面キャンバスの viewport 高さを確認する。
 *
 * 前提:
 *   pnpm --filter @raspi-system/web dev   # ポートは 4173 または 4174
 *   E2E_WEB_BASE_URL=http://127.0.0.1:4174  # 実際の Vite ポートに合わせる
 *   E2E_SELF_INSPECTION_SESSION_ID=<uuid>
 *   E2E_API_ORIGIN=https://100.106.158.2  # セッション・図面の取得元（任意）
 */
const webBase = (process.env.E2E_WEB_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const apiOrigin = (process.env.E2E_API_ORIGIN ?? 'https://100.106.158.2').replace(/\/$/, '');
const sessionId = process.env.E2E_SELF_INSPECTION_SESSION_ID?.trim();
const clientKey = process.env.E2E_KIOSK_CLIENT_KEY?.trim() ?? 'client-key-raspberrypi4-kiosk1';

test.describe('自主検査セッション図面レイアウト', () => {
  test.skip(!sessionId, 'E2E_SELF_INSPECTION_SESSION_ID が必要');

  test.use({ ignoreHTTPSErrors: true });
  test.setTimeout(120_000);

  test('図面キャンバス viewport の clientHeight > 0', async ({ page, request }) => {
    const sessionRes = await request.get(
      `${apiOrigin}/api/part-measurement/self-inspection/sessions/${sessionId}?entryIndex=0`,
      { headers: { 'x-client-key': clientKey } }
    );
    expect(sessionRes.ok()).toBeTruthy();
    const sessionJson = (await sessionRes.json()) as {
      session: {
        template: { visualTemplate?: { drawingImageRelativePath?: string } | null };
      };
    };
    const drawingPath = sessionJson.session.template.visualTemplate?.drawingImageRelativePath?.trim();
    expect(drawingPath).toBeTruthy();

    let drawingBody: Buffer | null = null;
    if (drawingPath) {
      const storagePath = drawingPath.replace(/^\/api\//, '/api/');
      const drawingRes = await request.get(`${apiOrigin}${storagePath}`, {
        headers: { 'x-client-key': clientKey }
      });
      expect(drawingRes.ok()).toBeTruthy();
      drawingBody = Buffer.from(await drawingRes.body());
    }

    await page.route('**/api/**', async (route) => {
      const incoming = new URL(route.request().url());
      const path = incoming.pathname;

      if (path.includes('/system/deploy-status')) {
        await route.fulfill({ json: { isMaintenance: false } });
        return;
      }
      if (path.includes('/kiosk/config')) {
        await route.fulfill({
          json: {
            defaultMode: 'tag',
            clientStatus: null
          }
        });
        return;
      }
      if (path.includes(`/self-inspection/sessions/${sessionId}`)) {
        await route.fulfill({ json: sessionJson, contentType: 'application/json' });
        return;
      }
      if (drawingPath && path.includes('/storage/part-measurement-drawings/')) {
        await route.fulfill({
          body: drawingBody ?? undefined,
          contentType: 'image/jpeg'
        });
        return;
      }
      if (path.includes('/kiosk/call/targets')) {
        await route.fulfill({ json: { selfClientId: 'e2e', targets: [] } });
        return;
      }

      await route.continue();
    });

    await page.addInitScript((key) => {
      window.localStorage.setItem('kiosk-client-key', JSON.stringify(key));
    }, clientKey);

    const url = `${webBase}/kiosk/part-measurement/self-inspection/sessions/${sessionId}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });

    await expect(page.getByText('読込中…')).toHaveCount(0, { timeout: 60_000 });

    const viewport = page.locator('[role="presentation"]').first();
    await expect(viewport).toBeVisible({ timeout: 60_000 });

    await expect
      .poll(async () => viewport.evaluate((el) => el.clientHeight), { timeout: 60_000 })
      .toBeGreaterThan(0);

    const naturalLoaded = await page.evaluate(() => {
      const img = document.querySelector('[role="presentation"] img');
      if (!img || !(img instanceof HTMLImageElement)) return false;
      return img.naturalWidth > 0 && img.naturalHeight > 0;
    });
    expect(naturalLoaded).toBe(true);
  });
});
