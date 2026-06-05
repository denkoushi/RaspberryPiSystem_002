import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PartMeasurementVisualTemplateService } from './part-measurement-visual-template.service.js';

const { prismaMock, deleteDrawingMock } = vi.hoisted(() => ({
  prismaMock: {
    partMeasurementVisualTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn()
    },
    partMeasurementTemplate: {
      count: vi.fn()
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn()
  },
  deleteDrawingMock: vi.fn()
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: prismaMock
}));

vi.mock('../../lib/part-measurement-drawing-storage.js', () => ({
  PartMeasurementDrawingStorage: {
    deleteDrawing: deleteDrawingMock
  }
}));

describe('PartMeasurementVisualTemplateService.list', () => {
  const service = new PartMeasurementVisualTemplateService();

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.partMeasurementVisualTemplate.findMany.mockResolvedValue([]);
  });

  it('filters active templates by name query with limit', async () => {
    await service.list({ q: 'alpha', limit: 25 });

    expect(prismaMock.partMeasurementVisualTemplate.findMany).toHaveBeenCalledWith({
      where: { isActive: true, name: { contains: 'alpha', mode: 'insensitive' } },
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
      take: 25
    });
  });

  it('returns all templates when includeInactive and no limit', async () => {
    await service.list({ includeInactive: true });

    expect(prismaMock.partMeasurementVisualTemplate.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }]
    });
  });
});

describe('PartMeasurementVisualTemplateService.deleteIfUnused', () => {
  const service = new PartMeasurementVisualTemplateService();

  beforeEach(() => {
    vi.clearAllMocks();
    deleteDrawingMock.mockResolvedValue(undefined);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<string>) =>
      fn(prismaMock)
    );
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'vt-1' }]);
  });

  it('returns in_use when visual template is referenced', async () => {
    prismaMock.partMeasurementVisualTemplate.findUnique.mockResolvedValue({
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/a.png'
    });
    prismaMock.partMeasurementTemplate.count.mockResolvedValue(1);

    await expect(service.deleteIfUnused('vt-1')).resolves.toBe('in_use');
    expect(prismaMock.partMeasurementVisualTemplate.delete).not.toHaveBeenCalled();
    expect(deleteDrawingMock).not.toHaveBeenCalled();
  });

  it('deletes visual template and drawing when unused', async () => {
    prismaMock.partMeasurementVisualTemplate.findUnique.mockResolvedValue({
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/b.png'
    });
    prismaMock.partMeasurementTemplate.count.mockResolvedValue(0);
    prismaMock.partMeasurementVisualTemplate.delete.mockResolvedValue({});

    await expect(service.deleteIfUnused('vt-2')).resolves.toBe('deleted');
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(prismaMock.partMeasurementVisualTemplate.delete).toHaveBeenCalledWith({
      where: { id: 'vt-2' }
    });
    expect(deleteDrawingMock).toHaveBeenCalledWith('/api/storage/part-measurement-drawings/b.png');
  });
});
