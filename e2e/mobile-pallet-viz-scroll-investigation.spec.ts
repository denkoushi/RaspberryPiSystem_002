import { test, expect, type Page, type CDPSession } from '@playwright/test';

async function readPalletListScrollState(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const list = document.querySelector('[data-pallet-viz-item-list-scroll]');
    const html = document.documentElement;
    return {
      mainTop: main instanceof HTMLElement ? main.scrollTop : null,
      listTop: list instanceof HTMLElement ? list.scrollTop : null,
      htmlTop: html.scrollTop,
    };
  });
}

async function resetScrollPositions(page: Page) {
  await page.evaluate(() => {
    const list = document.querySelector('[data-pallet-viz-item-list-scroll]');
    if (list instanceof HTMLElement) list.scrollTop = 0;
    const main = document.querySelector('main');
    if (main instanceof HTMLElement) main.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
}

/** 実機タッチに近い縦スワイプ（上に指を動かす＝一覧が下にスクロール） */
async function cdpTouchSwipeVertical(client: CDPSession, x: number, yFrom: number, yTo: number, steps = 12) {
  const xi = Math.round(x);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: xi, y: Math.round(yFrom) }],
  });
  for (let i = 1; i <= steps; i++) {
    const y = yFrom + ((yTo - yFrom) * i) / steps;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: xi, y: Math.round(y) }],
    });
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

/** 配膳スマホパレット可視化のスクロール構造調査（計画: DevTools 相当の計測を自動化） */
function buildBoardWithManyItemsOnPallet1(itemCount: number) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `e2e-item-${i}`,
    machineCd: 'CD001',
    palletNo: 1,
    displayOrder: i,
    fhincd: `FH${String(i).padStart(4, '0')}`,
    fhinmei: `部品 ${i} 長めの名称でレイアウトを安定させる`,
    fseiban: `SEI-${i}`,
    machineName: null as string | null,
    machineNameDisplay: null as string | null,
    csvDashboardRowId: null as string | null,
    plannedStartDateDisplay: '2026-04-01',
    plannedQuantity: 10,
    outsideDimensionsDisplay: '100×200×30',
  }));
  return {
    machines: [
      {
        machineCd: 'CD001',
        machineName: '加工機1',
        illustrationUrl: null as string | null,
        palletCount: 10,
        pallets: Array.from({ length: 10 }, (_, p) => ({
          palletNo: p + 1,
          items: p === 0 ? items : [],
        })),
      },
    ],
  };
}

async function mockKioskPalletApis(page: Page, itemCount: number) {
  await page.route('**/api/system/deploy-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ isMaintenance: false }) })
  );
  await page.route('**/api/kiosk/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        theme: 'dark',
        greeting: '',
        idleTimeoutMs: 30_000,
        defaultMode: 'TAG',
        clientStatus: null,
      }),
    })
  );
  await page.route('**/api/kiosk/call/targets', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ selfClientId: 'e2e-client', targets: [] }),
    })
  );
  await page.route(
    (url) => url.pathname.endsWith('/kiosk/employees'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ employees: [] }),
      })
  );
  await page.route('**/api/kiosk/pallet-visualization/board', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildBoardWithManyItemsOnPallet1(itemCount)),
    })
  );
}

test.describe('配膳スマホ パレット可視化 スクロール計測', () => {
  test('部品一覧だけが縦スクロールし、ページ全体は動かない', async ({ page }) => {
    await mockKioskPalletApis(page, 24);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/kiosk/mobile-placement/pallet-viz', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'パレット' })).toBeVisible();
    const list = page.locator('[data-pallet-viz-item-list-scroll]');
    await expect(list.locator(':scope > button')).toHaveCount(24, { timeout: 15_000 });

    const metrics = await page.evaluate(() => {
      const snap = (el: Element | null) => {
        if (!(el instanceof HTMLElement)) return null;
        return {
          overflowY: getComputedStyle(el).overflowY,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          canScrollY: el.scrollHeight > el.clientHeight,
        };
      };
      const html = document.documentElement;
      return {
        list: snap(document.querySelector('[data-pallet-viz-item-list-scroll]')),
        main: snap(document.querySelector('main')),
        htmlCanScrollY: html.scrollHeight > html.clientHeight,
      };
    });
    console.log('[pallet-viz-scroll-investigation]', JSON.stringify(metrics, null, 2));

    expect(metrics.list, '部品一覧が見つかる').not.toBeNull();
    expect(metrics.list!.canScrollY, `部品一覧がスクロール可能: ${JSON.stringify(metrics.list)}`).toBe(true);
    expect(metrics.main?.canScrollY ?? false, `main はスクロールしない: ${JSON.stringify(metrics.main)}`).toBe(false);
    expect(metrics.htmlCanScrollY, 'ページ全体はスクロールしない').toBe(false);

    const scrollTopAfter = await list.evaluate((el) => {
      el.scrollBy(0, 500);
      return el.scrollTop;
    });
    expect(scrollTopAfter, '部品一覧が scrollBy で縦移動できること').toBeGreaterThan(0);

    await resetScrollPositions(page);

    const tileBox = await page
      .getByRole('group', { name: 'パレット番号' })
      .getByRole('button', { name: /^パレット 5・/ })
      .boundingBox();
    expect(tileBox, 'パレット5の bbox').not.toBeNull();
    await page.mouse.move(tileBox!.x + tileBox!.width / 2, tileBox!.y + tileBox!.height / 2);
    await page.mouse.wheel(0, 900);
    const afterTileWheel = await readPalletListScrollState(page);
    console.log('[pallet-viz-scroll-wheel]', JSON.stringify({ afterTileWheel }, null, 2));

    expect(afterTileWheel.listTop ?? 0, 'パレット番号の上でホイールしても一覧は動かない').toBe(0);
    expect(afterTileWheel.mainTop ?? 0, 'パレット番号の上でホイール後も main は動かない').toBe(0);
    expect(afterTileWheel.htmlTop ?? 0, 'パレット番号の上でホイール後も html は動かない').toBe(0);
  });
});

test.describe('配膳スマホ パレット可視化 タッチ相当ドラッグ', () => {
  test.use({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });

  /**
   * CDP タッチは OS/Chromium 版でパレット番号上の漏れ量がぶれるため、
   * パレット番号側は別テストの mouse wheel で検証し、ここではカード上のみを見る。
   */
  test('カード上 CDP タッチスワイプで一覧が縦スクロールする', async ({ page }) => {
    await mockKioskPalletApis(page, 24);
    await page.goto('/kiosk/mobile-placement/pallet-viz', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'パレット' })).toBeVisible();
    await expect(page.locator('[data-pallet-viz-item-list-scroll] > button')).toHaveCount(24, { timeout: 15_000 });

    await resetScrollPositions(page);
    const client = await page.context().newCDPSession(page);
    const list = page.locator('[data-pallet-viz-item-list-scroll]');
    const firstCard = list.locator('button').first();
    await firstCard.scrollIntoViewIfNeeded();
    const cardBox = await firstCard.boundingBox();
    expect(cardBox, '先頭カードの bbox').not.toBeNull();
    const cx = cardBox!.x + cardBox!.width / 2;
    const cy = cardBox!.y + cardBox!.height / 2;
    await cdpTouchSwipeVertical(client, cx, cy, cy - 180);

    const afterCardDrag = await readPalletListScrollState(page);
    console.log('[pallet-viz-touch-card-drag]', JSON.stringify({ afterCardDrag }, null, 2));
    expect(afterCardDrag.listTop ?? 0, 'カード上ドラッグで一覧が縦スクロールする').toBeGreaterThan(15);
    expect(afterCardDrag.mainTop ?? 0, 'カード上ドラッグ後も main は動かない').toBe(0);
  });
});
