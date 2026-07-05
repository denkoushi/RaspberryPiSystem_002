import {
  buildDefaultInspectionDrawingMeasurementLabelSettings,
  mergeInspectionDrawingMeasurementLabelSettings,
  normalizeInspectionDrawingMeasurementLabel,
  type InspectionDrawingMeasurementLabelSetting,
  type InspectionDrawingToleranceKind
} from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

type DbToleranceKind = 'DIMENSION' | 'GEOMETRIC';

function apiToleranceKindFromDb(kind: DbToleranceKind): InspectionDrawingToleranceKind {
  return kind === 'GEOMETRIC' ? 'geometric' : 'dimension';
}

function dbToleranceKindFromApi(kind: InspectionDrawingToleranceKind): DbToleranceKind {
  return kind === 'geometric' ? 'GEOMETRIC' : 'DIMENSION';
}

function normalizeSetting(setting: InspectionDrawingMeasurementLabelSetting): InspectionDrawingMeasurementLabelSetting {
  const label = normalizeInspectionDrawingMeasurementLabel(setting.label);
  if (!label) {
    throw new ApiError(400, '測定点名称が空です');
  }
  return { label, toleranceKind: setting.toleranceKind };
}

export class InspectionDrawingMeasurementLabelSettingsService {
  async listSettings(): Promise<InspectionDrawingMeasurementLabelSetting[]> {
    const rows = await prisma.partMeasurementInspectionLabelSetting.findMany({
      orderBy: { label: 'asc' },
      select: {
        label: true,
        toleranceKind: true
      }
    });

    return mergeInspectionDrawingMeasurementLabelSettings(
      buildDefaultInspectionDrawingMeasurementLabelSettings(),
      rows.map((row) => ({
        label: row.label,
        toleranceKind: apiToleranceKindFromDb(row.toleranceKind)
      }))
    );
  }

  async replaceSettings(
    settings: readonly InspectionDrawingMeasurementLabelSetting[]
  ): Promise<InspectionDrawingMeasurementLabelSetting[]> {
    const normalized = settings.map(normalizeSetting);
    const seen = new Set<string>();
    for (const setting of normalized) {
      if (seen.has(setting.label)) {
        throw new ApiError(400, `測定点名称が重複しています: ${setting.label}`);
      }
      seen.add(setting.label);
    }

    await prisma.$transaction(async (tx) => {
      if (normalized.length === 0) {
        await tx.partMeasurementInspectionLabelSetting.deleteMany({});
      } else {
        await tx.partMeasurementInspectionLabelSetting.deleteMany({
          where: { label: { notIn: normalized.map((setting) => setting.label) } }
        });
      }
      for (const setting of normalized) {
        await tx.partMeasurementInspectionLabelSetting.upsert({
          where: { label: setting.label },
          create: {
            label: setting.label,
            toleranceKind: dbToleranceKindFromApi(setting.toleranceKind)
          },
          update: {
            toleranceKind: dbToleranceKindFromApi(setting.toleranceKind)
          }
        });
      }
    });

    return this.listSettings();
  }
}
