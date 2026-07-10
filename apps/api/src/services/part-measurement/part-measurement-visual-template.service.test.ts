import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PartMeasurementVisualTemplateService } from './part-measurement-visual-template.service.js';

const { prismaMock, deleteDrawingMock } = vi.hoisted(() => ({
  prismaMock: {
    partMeasurementVisualTemplate: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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

  it('combines raw name and normalized digit queries', async () => {
    await service.list({ q: 'alpha', digitQuery: '71-A61', limit: 25 });

    expect(prismaMock.partMeasurementVisualTemplate.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        name: { contains: 'alpha', mode: 'insensitive' },
        searchDigits: { contains: '7161' }
      },
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

  it('sorts by recently updated when sort is recentlyUpdated', async () => {
    await service.list({ limit: 40, sort: 'recentlyUpdated' });

    expect(prismaMock.partMeasurementVisualTemplate.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: 40
    });
  });
});

describe('PartMeasurementVisualTemplateService.getById', () => {
  const service = new PartMeasurementVisualTemplateService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active visual template by id', async () => {
    prismaMock.partMeasurementVisualTemplate.findUnique.mockResolvedValue({
      id: 'vt-1',
      name: '図面A',
      isActive: true
    });

    await expect(service.getById('vt-1')).resolves.toMatchObject({ id: 'vt-1' });
    expect(prismaMock.partMeasurementVisualTemplate.findUnique).toHaveBeenCalledWith({
      where: { id: 'vt-1' }
    });
  });

  it('returns null for inactive visual unless includeInactive', async () => {
    prismaMock.partMeasurementVisualTemplate.findUnique.mockResolvedValue({
      id: 'vt-2',
      isActive: false
    });

    await expect(service.getById('vt-2')).resolves.toBeNull();
    await expect(service.getById('vt-2', { includeInactive: true })).resolves.toMatchObject({
      id: 'vt-2'
    });
  });
});

describe('PartMeasurementVisualTemplateService.updateName', () => {
  const service = new PartMeasurementVisualTemplateService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates active visual template name', async () => {
    prismaMock.partMeasurementVisualTemplate.findUnique.mockResolvedValue({
      id: 'vt-1',
      name: '旧名',
      isActive: true
    });
    prismaMock.partMeasurementVisualTemplate.update.mockResolvedValue({
      id: 'vt-1',
      name: '新名71-A61'
    });

    await expect(service.updateName('vt-1', '  新名71-A61  ')).resolves.toMatchObject({ name: '新名71-A61' });
    expect(prismaMock.partMeasurementVisualTemplate.update).toHaveBeenCalledWith({
      where: { id: 'vt-1' },
      data: { name: '新名71-A61', searchDigits: '7161' }
    });
  });

  it('rejects empty name', async () => {
    await expect(service.updateName('vt-1', '   ')).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.partMeasurementVisualTemplate.update).not.toHaveBeenCalled();
  });

  it('rejects name longer than 200 characters', async () => {
    await expect(service.updateName('vt-1', 'a'.repeat(201))).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.partMeasurementVisualTemplate.update).not.toHaveBeenCalled();
  });

  it('returns 404 for missing or inactive visual', async () => {
    prismaMock.partMeasurementVisualTemplate.findUnique.mockResolvedValue(null);
    await expect(service.updateName('missing', '新名')).rejects.toMatchObject({ statusCode: 404 });

    prismaMock.partMeasurementVisualTemplate.findUnique.mockResolvedValue({
      id: 'vt-inactive',
      isActive: false
    });
    await expect(service.updateName('vt-inactive', '新名')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('PartMeasurementVisualTemplateService.create', () => {
  const service = new PartMeasurementVisualTemplateService();

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.partMeasurementVisualTemplate.create.mockResolvedValue({ id: 'vt-created' });
  });

  it('stores normalized drawing-name digits with the visual template', async () => {
    await service.create({
      name: '  図面71-A61  ',
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/a.png'
    });

    expect(prismaMock.partMeasurementVisualTemplate.create).toHaveBeenCalledWith({
      data: {
        name: '図面71-A61',
        searchDigits: '7161',
        drawingImageRelativePath: '/api/storage/part-measurement-drawings/a.png',
        isActive: true
      }
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
