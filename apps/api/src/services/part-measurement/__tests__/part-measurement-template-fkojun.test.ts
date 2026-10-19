import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    partMeasurementTemplateSiblingGroup: { create: vi.fn() },
    partMeasurementTemplate: {
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn()
    }
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
      partMeasurementTemplate: { findMany: vi.fn() }
    }
  };
});

vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../part-measurement-template-lineage-lock.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../part-measurement-template-lineage-lock.js')>()),
  acquireThreeKeyLineageTransactionLock: vi.fn()
}));
vi.mock('../part-measurement-visual-template.service.js', () => ({
  lockActiveVisualTemplateForBindingInTransaction: vi.fn()
}));

import { PartMeasurementTemplateService } from '../part-measurement-template.service.js';

describe('PartMeasurementTemplateService FKOJUN identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.partMeasurementTemplateSiblingGroup.create.mockResolvedValue({ id: 'group-10' });
    mocks.tx.partMeasurementTemplate.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.fkojun === '20' ? { id: 'existing-order-20' } : null
    );
    mocks.tx.partMeasurementTemplate.aggregate.mockResolvedValue({ _max: { version: null } });
    mocks.tx.partMeasurementTemplate.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.partMeasurementTemplate.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...args.data,
      id: 'template-order-10',
      resourceCd: args.data.resourceCd,
      visualTemplate: null,
      items: []
    }));
  });

  it('allows the same part and resource for a different FKOJUN while preserving the requested order key', async () => {
    mocks.tx.partMeasurementTemplate.aggregate.mockResolvedValue({ _max: { version: 1 } });
    const result = await new PartMeasurementTemplateService().createInspectionDrawingTemplateSiblingGroup({
      fhincd: 'PART-1',
      processGroup: 'CUTTING',
      resourceCds: ['R1'],
      fkojun: '10',
      name: '図面',
      visualTemplateId: 'visual-1',
      items: [{
        sortOrder: 0,
        datumSurface: 'A',
        measurementPoint: 'P1',
        measurementLabel: '幅',
        markerXRatio: 0.5,
        markerYRatio: 0.5,
        lowerLimit: 9,
        upperLimit: 11
      }]
    });

    expect(mocks.tx.partMeasurementTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        resourceCd: 'R1',
        isActive: true,
        AND: expect.arrayContaining([expect.objectContaining({ fkojun: '10' })])
      })
    }));
    expect(mocks.tx.partMeasurementTemplateSiblingGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fhincd: 'PART-1', processGroup: 'CUTTING', fkojun: '10' })
    });
    expect(mocks.tx.partMeasurementTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fhincd: 'PART-1', resourceCd: 'R1', fkojun: '10', version: 2 })
    }));
    expect(mocks.tx.partMeasurementTemplate.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ fhincd: expect.anything(), processGroup: 'CUTTING', resourceCd: 'R1' })
    }));
    expect(mocks.tx.partMeasurementTemplate.aggregate.mock.calls[0]?.[0]?.where).not.toHaveProperty('fkojun');
    expect(result.templates[0]?.fkojun).toBe('10');
  });
});
