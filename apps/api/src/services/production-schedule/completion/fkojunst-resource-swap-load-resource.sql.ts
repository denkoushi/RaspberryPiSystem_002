import { Prisma } from '@prisma/client';

/**
 * The resource that carries a row's load: the saved open-swap target, or the CSV resource.
 * Needs `"ext"` joined as ProductionScheduleExternalCompletion and `"CsvDashboardRow"` in scope.
 */
export const LOAD_RESOURCE_CD_SQL = Prisma.sql`UPPER(BTRIM(COALESCE(
  "ext"."loadResourceCdFromFkojunstResourceSwap", "CsvDashboardRow"."rowData"->>'FSIGENCD'
)))`;
