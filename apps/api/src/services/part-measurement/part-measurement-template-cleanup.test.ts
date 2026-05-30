import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PartMeasurementTemplateService } from './part-measurement-template.service.js';
import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from './part-measurement-constants.js';

const { prismaMock, deleteDrawingMock } = vi.hoisted(() => ({
  prismaMock: {
    partMeasurementTemplate: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      count: vi.fn()
    },
    partMeasurementSheet: {
      deleteMany: vi.fn()
    },
    partMeasurementVisualTemplate: {
      delete: vi.fn(),
      count: vi.fn()
    },
    $transaction: vi.fn()
  },
  deleteDrawingMock: vi.fn()
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: prismaMock
}));

vi.mock('./part-measurement-drawing-storage.js', () => ({
  PartMeasurementDrawingStorage: {
    deleteDrawing: deleteDrawingMock
  }
}));

describe('cleanupInspectionDrawingEvaluationTemplate', () => {
  const service = new PartMeasurementTemplateService();

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<void>) =>
      fn(prismaMock)
    );
    prismaMock.partMeasurementSheet.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.partMeasurementTemplate.delete.mockResolvedValue({});
    prismaMock.partMeasurementTemplate.count.mockResolvedValue(0);
    prismaMock.partMeasurementVisualTemplate.delete.mockResolvedValue({});
    deleteDrawingMock.mockResolvedValue(undefined);
  });

  it('does not delete reused visual template when createdVisualTemplateId is omitted', async () => {
    prismaMock.partMeasurementTemplate.findUnique.mockResolvedValue({
      id: 'tpl-1',
      fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD,
      visualTemplateId: 'vt-shared',
      visualTemplate: {
        drawingImageRelativePath: '/api/storage/part-measurement-drawings/shared.png'
      }
    });

    await service.cleanupInspectionDrawingEvaluationTemplate('tpl-1');

    expect(prismaMock.partMeasurementVisualTemplate.delete).not.toHaveBeenCalled();
    expect(deleteDrawingMock).not.toHaveBeenCalled();
  });

  it('deletes visual template only when it was created in the same evaluation request', async () => {
    prismaMock.partMeasurementTemplate.findUnique.mockResolvedValue({
      id: 'tpl-1',
      fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD,
      visualTemplateId: 'vt-new',
      visualTemplate: {
        drawingImageRelativePath: '/api/storage/part-measurement-drawings/new.png'
      }
    });

    await service.cleanupInspectionDrawingEvaluationTemplate('tpl-1', {
      createdVisualTemplateId: 'vt-new'
    });

    expect(prismaMock.partMeasurementVisualTemplate.delete).toHaveBeenCalledWith({
      where: { id: 'vt-new' }
    });
  });
});
