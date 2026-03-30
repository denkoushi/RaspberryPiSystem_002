import type { Prisma } from '@prisma/client';

/**
 * シート・解決レスポンス等でテンプレートを返すときの共通 include。
 * visual template をネストして返す。
 */
export const partMeasurementTemplateFullInclude = {
  items: { orderBy: { sortOrder: 'asc' as const } },
  visualTemplate: true
} satisfies Prisma.PartMeasurementTemplateInclude;
