import { expect, test, type Page } from '@playwright/test';

import {
  assertBandFitsWithinWidth,
  assertBandHeightWithinTwoRows,
  assertNoOrphanInspectionCountChip,
  countBandVisualRows,
  mockKioskLayoutApis
} from './helpers/inspectionDrawingCreateHeaderLayout';

const scenarios = ['revise', 'fixed_count', 'create_new'] as const;

const MARKER_DRAG_TEMPLATE_ID = 'e2e-marker-drag-template';
const MARKER_DRAG_VISUAL_ID = 'e2e-marker-drag-visual';
const MARKER_DRAG_DRAWING_PATH = '/api/storage/part-measurement-drawings/e2e-marker-drag.svg';

const markerDragTemplate = {
  id: MARKER_DRAG_TEMPLATE_ID,
  fhincd: 'E2E-MARKER-DRAG',
  resourceCd: 'R001',
  processGroup: 'cutting',
  templateScope: 'three_key',
  candidateFhinmei: null,
  name: 'E2E marker drag template',
  version: 1,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: MARKER_DRAG_VISUAL_ID,
  visualTemplate: {
    id: MARKER_DRAG_VISUAL_ID,
    name: 'E2E marker drag drawing',
    drawingImageRelativePath: MARKER_DRAG_DRAWING_PATH,
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  },
  siblingGroupId: null,
  siblingGroup: null,
  items: [
    {
      id: 'e2e-marker-drag-point-1',
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: 'P1',
      measurementLabel: '外径',
      displayMarker: '1',
      unit: 'mm',
      allowNegative: true,
      decimalPlaces: 2,
      markerXRatio: '0.25',
      markerYRatio: '0.25',
      calloutTipXRatio: null,
      calloutTipYRatio: null,
      nominalValue: '10',
      lowerLimit: '9.9',
      upperLimit: '10.1'
    }
  ]
} as const;

type OcrCandidateRequest = {
  xRatio: number;
  yRatio: number;
  markerNo?: number;
};

const markerDragDrawingSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#f8fafc"/>
  <rect x="24" y="24" width="752" height="552" fill="none" stroke="#334155" stroke-width="4"/>
</svg>
`.trim();

async function installMarkerDragApiMocks(page: Page) {
  const ocrCandidateRequests: OcrCandidateRequest[] = [];
  const unexpectedApiRequests: string[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    // Vite ソース（/src/api/client.ts 等）を HTTP API と誤マッチしない
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
      await route.fulfill({ json: { selfClientId: 'e2e-marker-drag', targets: [] } });
      return;
    }
    if (path === '/api/kiosk/employees') {
      await route.fulfill({ json: { employees: [] } });
      return;
    }
    if (path === '/api/kiosk/production-schedule/resources') {
      await route.fulfill({ json: { resources: ['R001'], resourceNameMap: {} } });
      return;
    }
    if (path === '/api/part-measurement/inspection-drawing/measurement-label-settings') {
      await route.fulfill({ json: { settings: [] } });
      return;
    }
    if (path === `/api/part-measurement/inspection-drawing/templates/${MARKER_DRAG_TEMPLATE_ID}`) {
      await route.fulfill({ json: { template: markerDragTemplate } });
      return;
    }
    if (path === `/api/part-measurement/visual-templates/${MARKER_DRAG_VISUAL_ID}/ocr`) {
      await route.fulfill({ json: { ocr: { status: 'completed' } } });
      return;
    }
    if (path === `${MARKER_DRAG_DRAWING_PATH}`) {
      await route.fulfill({ body: markerDragDrawingSvg, contentType: 'image/svg+xml' });
      return;
    }
    if (
      path === `/api/part-measurement/visual-templates/${MARKER_DRAG_VISUAL_ID}/ocr/candidates` &&
      request.method() === 'POST'
    ) {
      const body = request.postDataJSON() as OcrCandidateRequest;
      ocrCandidateRequests.push(body);
      await route.fulfill({
        json: {
          status: 'completed',
          candidates: [],
          cache: { status: 'completed' }
        }
      });
      return;
    }

    unexpectedApiRequests.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 404, json: { message: `Unexpected E2E API request: ${path}` } });
  });

  return { ocrCandidateRequests, unexpectedApiRequests };
}

test.describe('検査図面作成ヘッダー フラット band レイアウト', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      window.localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-raspberrypi4-kiosk1'));
    });
    await mockKioskLayoutApis(page);
  });

  for (const scenario of scenarios) {
    test(`${scenario}: 1280px で最大2行・孤児 chip なし・横溢れなし`, async ({ page }) => {
      await page.goto(`/dev/kiosk-inspection-drawing-create?scenario=${scenario}`, {
        waitUntil: 'networkidle'
      });

      await expect(page.getByTestId('inspection-drawing-create-header-band')).toBeVisible();

      const rowCount = await countBandVisualRows(page);
      expect(rowCount).toBeLessThanOrEqual(2);

      await assertNoOrphanInspectionCountChip(page);
      await assertBandFitsWithinWidth(page);
      await assertBandHeightWithinTwoRows(page);
    });
  }
});

test.describe('検査図面実編集画面の測定点ドラッグ', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      window.localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-raspberrypi4-kiosk1'));
    });
    await mockKioskLayoutApis(page);
  });

  test('既存測定点のドラッグを画面状態へ反映しOCRを1回再取得、背景の新規点追加と競合しない', async ({ page }) => {
    const { ocrCandidateRequests, unexpectedApiRequests } = await installMarkerDragApiMocks(page);
    await page.goto(`/kiosk/part-measurement/inspection/templates/${MARKER_DRAG_TEMPLATE_ID}/edit`, {
      waitUntil: 'networkidle'
    });

    const canvas = page.locator('div[role="presentation"]');
    await expect(canvas).toBeVisible();
    const marker = canvas.getByRole('button', { name: '外径' });
    await expect(marker).toBeVisible();
    const image = canvas.locator('img').last();
    await expect(image).toBeVisible();
    await expect.poll(() => ocrCandidateRequests.length).toBeGreaterThan(0);

    const imageBox = await image.boundingBox();
    const markerBox = await marker.boundingBox();
    expect(imageBox).not.toBeNull();
    expect(markerBox).not.toBeNull();

    const target = {
      x: imageBox!.x + imageBox!.width * 0.65,
      y: imageBox!.y + imageBox!.height * 0.65
    };
    const markerCenter = {
      x: markerBox!.x + markerBox!.width / 2,
      y: markerBox!.y + markerBox!.height / 2
    };

    await page.mouse.move(markerCenter.x, markerCenter.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => {
      return ocrCandidateRequests.filter(
        (request) => request.markerNo === 1 && request.xRatio > 0.6 && request.yRatio > 0.6
      ).length;
    }).toBe(1);

    const movedMarkerBox = await marker.boundingBox();
    expect(movedMarkerBox).not.toBeNull();
    expect(Math.abs(movedMarkerBox!.x + movedMarkerBox!.width / 2 - target.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(movedMarkerBox!.y + movedMarkerBox!.height / 2 - target.y)).toBeLessThanOrEqual(2);

    const pointButtonsBeforeBackgroundClick = await canvas.getByRole('button').count();
    const background = {
      x: imageBox!.x + imageBox!.width * 0.2,
      y: imageBox!.y + imageBox!.height * 0.8
    };
    await page.mouse.click(background.x, background.y);
    await expect(canvas.getByRole('button')).toHaveCount(pointButtonsBeforeBackgroundClick + 1);
    await expect(canvas.getByRole('button', { name: '測定点 2' })).toBeVisible();

    const movedMarkerAfterPlacement = await marker.boundingBox();
    expect(movedMarkerAfterPlacement).not.toBeNull();
    expect(
      Math.abs(movedMarkerAfterPlacement!.x + movedMarkerAfterPlacement!.width / 2 - target.x)
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(movedMarkerAfterPlacement!.y + movedMarkerAfterPlacement!.height / 2 - target.y)
    ).toBeLessThanOrEqual(2);
    expect(unexpectedApiRequests).toEqual([]);
  });
});
