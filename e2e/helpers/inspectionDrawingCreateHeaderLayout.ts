import { expect, type Page } from '@playwright/test';

const ROW_TOLERANCE_PX = 4;

export type LayoutBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function centerY(box: LayoutBox): number {
  return box.y + box.height / 2;
}

export function groupBoxesByVisualRow(boxes: LayoutBox[], tolerancePx = ROW_TOLERANCE_PX): LayoutBox[][] {
  const sorted = [...boxes].sort((a, b) => centerY(a) - centerY(b));
  const rows: LayoutBox[][] = [];

  for (const box of sorted) {
    const cy = centerY(box);
    const row = rows.find((candidate) => Math.abs(centerY(candidate[0]!) - cy) <= tolerancePx);
    if (row) {
      row.push(box);
    } else {
      rows.push([box]);
    }
  }

  return rows;
}

export function verticalOverlap(a: LayoutBox, b: LayoutBox): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height;
}

export async function mockKioskLayoutApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    // Vite ソース（/src/api/client.ts 等）を HTTP API と誤マッチしない
    if (path.startsWith('/src/api/')) {
      await route.continue();
      return;
    }

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
    if (path.includes('/kiosk/call/targets')) {
      await route.fulfill({ json: { selfClientId: 'e2e', targets: [] } });
      return;
    }

    await route.continue();
  });
}

export async function collectHeaderLayoutBoxes(page: Page): Promise<LayoutBox[]> {
  const band = page.getByTestId('inspection-drawing-create-header-band');
  await expect(band).toBeVisible();

  return band.evaluate((root) => {
    const toBox = (el: Element): LayoutBox | null => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const boxes: LayoutBox[] = [];

    root.querySelectorAll('[data-testid="inspection-drawing-create-meta-chip"]').forEach((el) => {
      const box = toBox(el);
      if (box) boxes.push(box);
    });

    const versionBadge = root.querySelector('[data-testid="inspection-drawing-create-version-badge"]');
    if (versionBadge) {
      const box = toBox(versionBadge);
      if (box) boxes.push(box);
    }

    const drawingFile = root.querySelector('[data-testid="inspection-drawing-create-drawing-file"]');
    if (drawingFile) {
      const box = toBox(drawingFile);
      if (box) boxes.push(box);
    }

    const zoomSlot = root.querySelector('[data-testid="inspection-drawing-create-zoom-slot"]');
    if (zoomSlot) {
      const box = toBox(zoomSlot);
      if (box) boxes.push(box);
    }

    root
      .querySelectorAll('[data-testid="inspection-drawing-create-toolbar-slot"] button, [data-testid="inspection-drawing-create-toolbar-slot"] a')
      .forEach((el) => {
        const box = toBox(el);
        if (box) boxes.push(box);
      });

    return boxes;
  });
}

export async function countBandVisualRows(page: Page): Promise<number> {
  const boxes = await collectHeaderLayoutBoxes(page);
  return groupBoxesByVisualRow(boxes).length;
}

export async function assertBandFitsWithinWidth(page: Page): Promise<void> {
  const metrics = await page.getByTestId('inspection-drawing-create-header-band').evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

export async function assertNoOrphanInspectionCountChip(page: Page): Promise<void> {
  const layout = await page.getByTestId('inspection-drawing-create-header-band').evaluate((root) => {
    const toBox = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const chips = Array.from(
      root.querySelectorAll('[data-testid="inspection-drawing-create-meta-chip"]')
    ).map((el) => ({
      term: el.getAttribute('data-chip-term'),
      box: toBox(el)
    }));

    const controls = Array.from(
      root.querySelectorAll(
        '[data-testid="inspection-drawing-create-version-badge"], [data-testid="inspection-drawing-create-drawing-file"], [data-testid="inspection-drawing-create-zoom-slot"], [data-testid="inspection-drawing-create-toolbar-slot"] button, [data-testid="inspection-drawing-create-toolbar-slot"] a'
      )
    ).map((el) => toBox(el));

    return { chips, controls };
  });

  const inspectionChip = layout.chips.find((chip) => chip.term === '検査数');
  expect(inspectionChip).toBeTruthy();

  const otherChips = layout.chips.filter((chip) => chip.term !== '検査数');
  const sharesRowWithOtherChip = otherChips.some((chip) =>
    verticalOverlap(inspectionChip!.box, chip.box)
  );
  const sharesRowWithControl = layout.controls.some((box) =>
    verticalOverlap(inspectionChip!.box, box)
  );

  expect(sharesRowWithOtherChip || sharesRowWithControl).toBe(true);
}

export async function assertBandHeightWithinTwoRows(page: Page): Promise<void> {
  const bandMetrics = await page.getByTestId('inspection-drawing-create-header-band').evaluate((root) => {
    const boxes = Array.from(
      root.querySelectorAll(
        '[data-testid="inspection-drawing-create-meta-chip"], [data-testid="inspection-drawing-create-version-badge"], [data-testid="inspection-drawing-create-drawing-file"], [data-testid="inspection-drawing-create-zoom-slot"], [data-testid="inspection-drawing-create-toolbar-slot"] button, [data-testid="inspection-drawing-create-toolbar-slot"] a'
      )
    ).map((el) => el.getBoundingClientRect());

    const maxElementHeight = boxes.reduce((max, rect) => Math.max(max, rect.height), 0);
    const bandRect = root.getBoundingClientRect();

    return {
      bandHeight: bandRect.height,
      maxElementHeight
    };
  });

  expect(bandMetrics.bandHeight).toBeLessThanOrEqual(bandMetrics.maxElementHeight * 2 + 16);
}
