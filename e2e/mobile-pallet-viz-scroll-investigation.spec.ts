import { test, expect, type Page } from '@playwright/test';

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
  test('main / カード一覧（PalletVizItemList ルート）の scrollHeight・overflow を記録', async ({ page }) => {
    await mockKioskPalletApis(page, 24);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/kiosk/mobile-placement/pallet-viz', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'パレット可視化' })).toBeVisible();
    await expect(page.locator('main ul.space-y-2 > li')).toHaveCount(24, { timeout: 15_000 });

    const metrics = await page.evaluate(() => {
      const main = document.querySelector('main');
      const pageRoot = main ? [...main.children].find((el) => el.tagName !== 'H1') : null;
      const listUl = document.querySelector('main ul.space-y-2');
      const listRoot = listUl?.parentElement ?? null;
      /** カード一覧のみスクロール: PalletVizItemList ルートが scroll 担当 */
      const scrollBlock = listRoot;

      const snap = (el: Element | null, label: string) => {
        if (!el) return { label, missing: true as const };
        const st = getComputedStyle(el);
        return {
          label,
          missing: false as const,
          tag: el.tagName,
          className: typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '',
          overflowY: st.overflowY,
          flexGrow: st.flexGrow,
          minHeight: st.minHeight,
          clientHeight: (el as HTMLElement).clientHeight,
          scrollHeight: (el as HTMLElement).scrollHeight,
          scrollTop: (el as HTMLElement).scrollTop,
          canScrollY: (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight,
        };
      };

      return {
        main: snap(main, 'main'),
        pageRoot: snap(pageRoot, 'pageRoot'),
        scrollBlock: snap(scrollBlock ?? null, 'scrollBlock'),
        listRoot: snap(listRoot, 'listRoot'),
      };
    });

    expect(metrics.main.missing, 'main が存在する').toBe(false);
    expect(metrics.scrollBlock?.missing, 'ページ内 overflow-y スクロールブロックが見つかる').toBe(false);
    expect(metrics.listRoot?.missing, '一覧ルートが特定できる').toBe(false);

    if (!metrics.main.missing) {
      expect(
        metrics.main.canScrollY,
        `オーバーフローはページ内ブロックで吸収し main はスクロールしない想定: ${JSON.stringify(metrics.main)}`
      ).toBe(false);
    }

    if (metrics.scrollBlock && !metrics.scrollBlock.missing) {
      expect(
        metrics.scrollBlock.canScrollY,
        `カード一覧ルートがスクロール可能であること: ${JSON.stringify(metrics.scrollBlock)}`
      ).toBe(true);
    }

    if (metrics.listRoot && !metrics.listRoot.missing) {
      expect(
        metrics.listRoot.canScrollY,
        `一覧ルート＝スクロールコンテナ: ${JSON.stringify(metrics.listRoot)}`
      ).toBe(true);
    }

    // 調査ログ（HTML レポート・失敗時スクリーンショットと併せて確認可能）
    console.log('[pallet-viz-scroll-investigation]', JSON.stringify(metrics, null, 2));

    // スクロールブロックが実際に scrollBy 可能であること（ホイールはボタン上では親へ伝播しない場合あり）
    const scrollTopAfter = await page.evaluate(() => {
      const listUl = document.querySelector('main ul.space-y-2');
      const listRoot = listUl?.parentElement as HTMLElement | null;
      if (!listRoot) return -1;
      listRoot.scrollBy(0, 500);
      return listRoot.scrollTop;
    });
    expect(scrollTopAfter, 'カード一覧が scrollBy で縦移動できること').toBeGreaterThan(0);
  });
});
