import { expect, test, type Page } from '@playwright/test';

const CLIENT_KEY = 'client-key-raspberrypi4-kiosk1';
const BASE = '/api/part-measurement/self-inspection/reduction';

/** 決定的な疑似乱数（見本データを毎回同じにする）。 */
function createRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  return () => {
    let u = 0;
    let v = 0;
    while (!u) u = next();
    while (!v) v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

type PartSpec = {
  fhincd: string;
  fhinmei: string;
  processGroup: 'cutting' | 'grinding';
  resourceCd: string;
  mode: 'full' | 'fixed_count' | 'first_last' | 'single';
  cpk: number;
  sample: number;
  streak: number;
  sinceChangePoint?: number;
  gap: number;
  drift?: boolean;
  out?: number;
  nonconformity?: number;
};

const SPECS: PartSpec[] = [
  { fhincd: 'MD00412163', fhinmei: 'シャフト', processGroup: 'cutting', resourceCd: '581', mode: 'full', cpk: 2.05, sample: 120, streak: 26, gap: 0.04 },
  { fhincd: 'MK02210040', fhinmei: 'フランジ', processGroup: 'cutting', resourceCd: '583', mode: 'full', cpk: 1.84, sample: 96, streak: 14, sinceChangePoint: 4, gap: 0.05 },
  { fhincd: 'MT01188802', fhinmei: 'スリーブ', processGroup: 'grinding', resourceCd: '612', mode: 'fixed_count', cpk: 1.93, sample: 64, streak: 18, gap: 0.03 },
  { fhincd: 'MD00533011', fhinmei: 'ピン', processGroup: 'cutting', resourceCd: '581', mode: 'first_last', cpk: 2.38, sample: 44, streak: 31, gap: 0.06 },
  { fhincd: 'MS00900127', fhinmei: 'ブッシュ', processGroup: 'grinding', resourceCd: '615', mode: 'full', cpk: 1.76, sample: 22, streak: 6, gap: 0.05 },
  { fhincd: 'MK02210051', fhinmei: 'カバー', processGroup: 'cutting', resourceCd: '590', mode: 'full', cpk: 1.45, sample: 120, streak: 12, gap: 0.07 },
  { fhincd: 'MT01190015', fhinmei: 'ロッド', processGroup: 'grinding', resourceCd: '612', mode: 'full', cpk: 1.21, sample: 150, streak: 4, gap: 0.06 },
  { fhincd: 'MT01200033', fhinmei: 'ギヤ軸', processGroup: 'grinding', resourceCd: '615', mode: 'full', cpk: 1.52, sample: 90, streak: 11, gap: 0.19 },
  { fhincd: 'MD00412170', fhinmei: 'シャフトB', processGroup: 'cutting', resourceCd: '581', mode: 'first_last', cpk: 1.4, sample: 40, streak: 0, gap: 0.05, out: 1 },
  { fhincd: 'MK02230007', fhinmei: 'ブラケット', processGroup: 'cutting', resourceCd: '583', mode: 'fixed_count', cpk: 1.62, sample: 55, streak: 3, gap: 0.04, nonconformity: 1 }
];

const ITEMS = [
  { label: '外径', point: 'φ32 −0.025/−0.050', nominal: 31.9625, lower: 31.95, upper: 31.975, decimalPlaces: 3 },
  { label: '全長', point: '120 ±0.10', nominal: 120, lower: 119.9, upper: 120.1, decimalPlaces: 2 },
  { label: '穴径', point: 'φ10 H7', nominal: 10.0075, lower: 10, upper: 10.015, decimalPlaces: 3 },
  { label: '溝幅', point: '8 ±0.05', nominal: 8, lower: 7.95, upper: 8.05, decimalPlaces: 3 }
];

function makePart(spec: PartSpec, index: number) {
  const gauss = createRandom(index + 7);
  const start = Date.UTC(2026, 6, 1);
  const items = ITEMS.slice(0, index % 3 === 2 ? 3 : 4).map((item, itemIndex) => {
    const cpk = itemIndex === 0 ? spec.cpk : spec.cpk * (1.3 + 0.3 * ((index + itemIndex) % 3));
    const half = (item.upper - item.lower) / 2;
    const offset = ((index + itemIndex) % 2 ? 1 : -1) * half * 0.12;
    const sd = (half - Math.abs(offset)) / (3 * cpk);
    const count = Math.min(spec.sample, 60);
    const values = Array.from({ length: count }, (_, k) => ({
      value: item.nominal + offset + sd * gauss(),
      measuredAt: new Date(start + k * 36e5 * 20).toISOString()
    }));
    if (spec.out && itemIndex === 0) values[count - 3]!.value = item.upper + half * 0.1;
    return {
      key: `A|${item.point}|${item.label}`,
      label: item.label,
      point: item.point,
      marker: String(itemIndex + 1),
      unit: 'mm',
      decimalPlaces: item.decimalPlaces,
      nominal: item.nominal,
      lower: item.lower,
      upper: item.upper,
      valueCount: spec.sample,
      mean: item.nominal + offset,
      standardDeviation: sd,
      cpk,
      drift: Boolean(spec.drift),
      outOfToleranceCount: spec.out && itemIndex === 0 ? spec.out : 0,
      values
    };
  });
  const lots = Array.from({ length: 20 }, (_, k) => ({
    pass: !(spec.out && k === 17) && !(spec.nonconformity && k === 12),
    completedAt: new Date(start + k * 864e5 * 3).toISOString()
  }));
  return {
    key: { fhincd: spec.fhincd, processGroup: spec.processGroup, resourceCd: spec.resourceCd },
    fhinmei: spec.fhinmei,
    machineName: ['NL2500', 'LB3000', 'GA-26', 'GE4i', 'MA-500'][index % 5],
    templateId: `template-${index}`,
    templateVersion: 2,
    lotCount: 24,
    lotsPerMonth: 8 + (index % 5),
    recentLots: lots,
    metrics: {
      level: { mode: spec.mode, fixedCount: spec.mode === 'fixed_count' ? 5 : null },
      lotSize: 40,
      evaluable: true,
      worstCpk: spec.cpk,
      sampleCount: spec.sample,
      consecutivePassLots: spec.streak,
      consecutivePassLotsSinceChangePoint: spec.sinceChangePoint ?? null,
      drift: Boolean(spec.drift),
      measurementGapRatio: spec.gap,
      outOfToleranceCount: spec.out ?? 0,
      nonconformityCount: spec.nonconformity ?? 0
    },
    items,
    worstItemKey: items[0]!.key,
    judgementFailCount: 0,
    changePoints: spec.sinceChangePoint
      ? [{ id: `cp-${index}`, kind: 'TOOL_CHANGE', occurredAt: new Date(start + 40 * 36e5 * 20).toISOString(), recordedByName: '社員A' }]
      : [],
    latestDecision: null
  };
}

async function installApiMocks(page: Page) {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/system/deploy-status') return route.fulfill({ json: { isMaintenance: false } });
    if (path === '/api/kiosk/config') return route.fulfill({ json: { defaultMode: 'tag', clientStatus: null } });
    if (path === '/api/kiosk/call/targets') return route.fulfill({ json: { selfClientId: 'reduction-e2e', targets: [] } });
    if (path === '/api/kiosk/support/targets') return route.fulfill({ json: { targets: [] } });
    if (path === `${BASE}/insights`) {
      return route.fulfill({
        json: {
          periodDays: 90,
          generatedAt: '2026-09-30T00:00:00.000Z',
          secondsPerPiece: 15,
          parts: SPECS.map(makePart)
        }
      });
    }
    if (path === `${BASE}/policy`) {
      return route.fulfill({
        json: {
          policy: {
            cpkThreshold: 1.67,
            requiredConsecutiveLots: 10,
            minimumSampleCount: 30,
            resetStreakOnChangePoint: true,
            updatedAt: null,
            updatedBy: null
          },
          approvers: [{ id: 'a1', employeeId: 'e1', employeeCode: '0412', displayName: '社員A', createdAt: '2026-09-30T00:00:00.000Z' }]
        }
      });
    }
    return route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });
}

async function openReductionPage(page: Page) {
  await installApiMocks(page);
  await page.addInitScript((clientKey) => {
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  }, CLIENT_KEY);
  await page.goto('/kiosk/part-measurement/self-inspection/reduction', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '減らせる検査', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /MD00412163/ })).toBeVisible();
}

test.describe('減らせる検査のキオスクレイアウト', () => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 }
  ]) {
    test(`${viewport.width}x${viewport.height}で判定と横overflowなしを維持する`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openReductionPage(page);

      const filters = page.getByRole('group', { name: '判定で絞り込み' });
      await expect(filters.getByRole('button', { name: /減らせる\s*3/ })).toBeVisible();

      const shell = await page.locator('body').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }));
      expect(shell.scrollWidth).toBeLessThanOrEqual(shell.clientWidth + 1);

      const screenshotDir = process.env.SELF_INSPECTION_E2E_SCREENSHOT_DIR?.replace(/\/$/, '');
      if (screenshotDir) {
        await page.screenshot({ path: `${screenshotDir}/self-inspection-reduction-${viewport.width}x${viewport.height}.png` });
      }
    });
  }

  test('Cpk基準を1.33にすると判定が変わる', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openReductionPage(page);
    const filters = page.getByRole('group', { name: '判定で絞り込み' });
    await page.getByRole('group', { name: '工程能力の基準' }).getByRole('button', { name: '1.33' }).click();
    await expect(filters.getByRole('button', { name: /減らせる\s*4/ })).toBeVisible();
  });

  test('品番を選ぶと6つの条件と承認ボタンが出る', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openReductionPage(page);
    await page.getByRole('option', { name: /MD00412163/ }).click();
    const detail = page.getByRole('region', { name: '判定の中身' });
    for (const title of ['データ量', '公差の余裕', '連続合格', 'ずれの傾向', '測り方の差', '規格外・後工程']) {
      await expect(detail.getByText(title, { exact: true })).toBeVisible();
    }
    await detail.getByRole('button', { name: '1段下げる' }).click();
    await expect(detail.getByText('承認者の社員タグをタッチ')).toBeVisible();

    const screenshotDir = process.env.SELF_INSPECTION_E2E_SCREENSHOT_DIR?.replace(/\/$/, '');
    if (screenshotDir) {
      await page.screenshot({ path: `${screenshotDir}/self-inspection-reduction-approval.png` });
      await page.getByRole('button', { name: '判定設定' }).click();
      await expect(page.getByRole('dialog', { name: '判定設定' })).toBeVisible();
      await page.screenshot({ path: `${screenshotDir}/self-inspection-reduction-settings.png` });
    }
  });
});
