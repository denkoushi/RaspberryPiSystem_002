import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

/** visual template の一覧・作成（図面は別ストレージに保存し DB には相対 URL のみ） */
export class PartMeasurementVisualTemplateService {
  async list(includeInactive: boolean) {
    return prisma.partMeasurementVisualTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }]
    });
  }

  async create(params: { name: string; drawingImageRelativePath: string }) {
    const name = params.name.trim();
    if (name.length === 0) {
      throw new ApiError(400, 'visual template 名が空です');
    }
    const path = params.drawingImageRelativePath.trim();
    if (!path.startsWith('/api/storage/part-measurement-drawings/')) {
      throw new ApiError(400, '図面の保存パスが不正です');
    }
    return prisma.partMeasurementVisualTemplate.create({
      data: {
        name,
        drawingImageRelativePath: path,
        isActive: true
      }
    });
  }
}
