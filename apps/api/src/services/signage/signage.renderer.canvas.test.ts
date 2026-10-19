import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  kioskProductionScheduleSearchState: {
    findUnique: vi.fn(),
  },
}));
const fetchSeibanProgressRowsMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../production-schedule/seiban-progress.service.js', () => ({
  fetchSeibanProgressRows: fetchSeibanProgressRowsMock,
}));

import { initializeVisualizationModules } from '../visualization/initialize.js';
import { signageCanvasLayoutSchema } from './signage-canvas.js';
import type { SignageCanvasLayoutConfig } from './signage-layout.types.js';
import { SignageRenderer } from './signage.renderer.js';

const rows = [
  { fseiban: 'PN-001', total: 10, completed: 7, incompleteProductNames: ['部品A'], machineName: '機械A' },
  { fseiban: 'PN-002', total: 8, completed: 4, incompleteProductNames: ['部品B'], machineName: '機械B' },
];

function canvasLayout(width: number, height: number): SignageCanvasLayoutConfig {
  return {
    layout: 'CANVAS',
    width,
    height,
    backgroundColor: '#020617',
    elements: [
      {
        id: 'heading',
        kind: 'text',
        x: Math.round(width * 0.02),
        y: Math.round(height * 0.03),
        width: Math.round(width * 0.96),
        height: Math.round(height * 0.1),
        text: '業務進捗ダッシュボード',
        style: { fontSize: Math.max(18, Math.round(width / 48)), fontWeight: '700' },
      },
      {
        id: 'kpi-left',
        kind: 'visualization',
        x: Math.round(width * 0.04),
        y: Math.round(height * 0.16),
        width: Math.round(width * 0.43),
        height: Math.round(height * 0.76),
        title: '左側の進捗',
        dataSourceType: 'production_schedule',
        dataSourceConfig: { view: 'kpi' },
        rendererType: 'kpi_cards',
        rendererConfig: {},
      },
      {
        id: 'kpi-right',
        kind: 'visualization',
        x: Math.round(width * 0.54),
        y: Math.round(height * 0.2),
        width: Math.round(width * 0.4),
        height: Math.round(height * 0.68),
        title: '右側の進捗',
        dataSourceType: 'production_schedule',
        dataSourceConfig: { view: 'kpi' },
        rendererType: 'kpi_cards',
        rendererConfig: {},
      },
    ],
  };
}

function digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

describe('SignageRenderer canvas preview', () => {
  beforeEach(() => {
    initializeVisualizationModules();
    prismaMock.kioskProductionScheduleSearchState.findUnique.mockReset();
    fetchSeibanProgressRowsMock.mockReset();
    prismaMock.kioskProductionScheduleSearchState.findUnique.mockResolvedValue({
      state: { history: ['PN-001', 'PN-002'] },
      updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    });
    fetchSeibanProgressRowsMock.mockResolvedValue(rows);
  });

  it('accepts the canvas bounds and rejects out-of-bounds elements', () => {
    expect(signageCanvasLayoutSchema.safeParse(canvasLayout(640, 360)).success).toBe(true);
    expect(signageCanvasLayoutSchema.safeParse(canvasLayout(3840, 2160)).success).toBe(true);
    expect(signageCanvasLayoutSchema.safeParse(canvasLayout(639, 360)).success).toBe(false);
    expect(signageCanvasLayoutSchema.safeParse(canvasLayout(640, 359)).success).toBe(false);

    const invalid = canvasLayout(640, 360);
    invalid.elements[1]!.x = 500;
    expect(signageCanvasLayoutSchema.safeParse(invalid).success).toBe(false);
  });

  it('fails the approval preview when an actual visualization element cannot render', async () => {
    const renderer = new SignageRenderer({} as never);
    const visualizationService = (renderer as unknown as {
      visualizationService: { renderToBuffer: ReturnType<typeof vi.fn> };
    }).visualizationService;
    visualizationService.renderToBuffer = vi.fn().mockRejectedValue(new Error('renderer unavailable'));

    await expect(renderer.renderCanvasPreviewToBuffer(canvasLayout(1920, 1080))).rejects.toThrow('renderer unavailable');
  });

  it('renders the same production data at distinct positions and sizes for 640x360 and 3840x2160 canvases', async () => {
    const renderer = new SignageRenderer({} as never);
    const small = await renderer.renderCanvasPreviewToBuffer(canvasLayout(640, 360));
    const large = await renderer.renderCanvasPreviewToBuffer(canvasLayout(3840, 2160));

    await expect(sharp(small).metadata()).resolves.toMatchObject({ width: 1920, height: 1080, format: 'jpeg' });
    await expect(sharp(large).metadata()).resolves.toMatchObject({ width: 1920, height: 1080, format: 'jpeg' });
    expect(digest(small)).not.toBe(digest(large));

    const outputPath = process.env.BUSINESS_HERMES_CANVAS_PREVIEW_OUTPUT;
    if (outputPath) {
      await fs.mkdir(dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, await renderer.renderCanvasPreviewToBuffer(canvasLayout(1920, 1080)));
    }
  });

  it('uses refreshed source data on the next render', async () => {
    const renderer = new SignageRenderer({} as never);
    const updatedRows = rows.map((row) => ({ ...row, completed: row.total }));
    const first = await renderer.renderCanvasPreviewToBuffer(canvasLayout(1920, 1080));
    fetchSeibanProgressRowsMock.mockResolvedValue(updatedRows);
    const second = await renderer.renderCanvasPreviewToBuffer(canvasLayout(1920, 1080));

    expect(fetchSeibanProgressRowsMock).toHaveBeenCalledTimes(4);
    expect(digest(first)).not.toBe(digest(second));
  });
});
