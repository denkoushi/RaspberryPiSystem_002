import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), readDrawing: vi.fn(), write: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  partMeasurementVisualTemplate: { findFirst: mocks.findFirst },
  partMeasurementDrawingOcrCache: { create: mocks.write, update: mocks.write, upsert: mocks.write }
} }));
vi.mock('../../lib/part-measurement-drawing-storage.js', () => ({ PartMeasurementDrawingStorage: { readDrawing: mocks.readDrawing } }));

import { PartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';

beforeEach(() => vi.resetAllMocks());

it('reads the current image fingerprint without enqueueing OCR or mutating its cache', async () => {
  const buffer = Buffer.from('drawing bytes');
  mocks.findFirst.mockResolvedValue({ drawingImageRelativePath: 'drawing.png' });
  mocks.readDrawing.mockResolvedValue({ buffer });
  const service = new PartMeasurementDrawingOcrService({} as never, {} as never, {} as never);
  expect(await service.getCurrentFingerprint('target')).toBe(createHash('sha256').update(buffer).digest('hex'));
  expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'target', isActive: true } });
  expect(mocks.readDrawing).toHaveBeenCalledWith('drawing.png');
  expect(mocks.write).not.toHaveBeenCalled();
});

it('rejects a missing active drawing without accessing storage', async () => {
  mocks.findFirst.mockResolvedValue(null);
  const service = new PartMeasurementDrawingOcrService({} as never, {} as never, {} as never);
  await expect(service.getCurrentFingerprint('missing')).rejects.toMatchObject({ statusCode: 404 });
  expect(mocks.readDrawing).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
