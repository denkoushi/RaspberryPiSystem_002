import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export type AssemblyLibraryFilterField =
  | 'templateModelCode'
  | 'templateProcedureDocumentName'
  | 'procedureDocumentName';

export type AssemblyLibraryFilterOptionsInput = {
  field: AssemblyLibraryFilterField;
  q?: string;
  includeInactive?: boolean;
  limit?: number;
};

type FilterOptionRow = { value: string };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function normalizeLimit(value: number | undefined): number {
  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

/**
 * Library filter candidates are independent of the 200-row summary endpoints.
 * Each query trims, case-folds, deduplicates and sorts at the database boundary.
 */
export class AssemblyLibraryFilterOptionsService {
  async list(input: AssemblyLibraryFilterOptionsInput): Promise<string[]> {
    const query = input.q?.trim() ?? '';
    const limit = normalizeLimit(input.limit);
    let rows: FilterOptionRow[];

    switch (input.field) {
      case 'templateModelCode':
        rows = await prisma.$queryRaw<FilterOptionRow[]>(Prisma.sql`
          SELECT MIN(BTRIM(t."modelCode")) AS "value"
          FROM "AssemblyTemplate" AS t
          WHERE BTRIM(t."modelCode") <> ''
            AND (${input.includeInactive === true} OR t."isActive" = true)
            AND (${query} = '' OR STRPOS(LOWER(BTRIM(t."modelCode")), LOWER(${query})) > 0)
          GROUP BY LOWER(BTRIM(t."modelCode"))
          ORDER BY LOWER(MIN(BTRIM(t."modelCode"))) ASC
          LIMIT ${limit}
        `);
        break;
      case 'templateProcedureDocumentName':
        rows = await prisma.$queryRaw<FilterOptionRow[]>(Prisma.sql`
          SELECT MIN(BTRIM(d."name")) AS "value"
          FROM "AssemblyTemplate" AS t
          INNER JOIN "AssemblyProcedureDocument" AS d ON d."id" = t."procedureDocumentId"
          WHERE BTRIM(d."name") <> ''
            AND (${input.includeInactive === true} OR t."isActive" = true)
            AND (${query} = '' OR STRPOS(LOWER(BTRIM(d."name")), LOWER(${query})) > 0)
          GROUP BY LOWER(BTRIM(d."name"))
          ORDER BY LOWER(MIN(BTRIM(d."name"))) ASC
          LIMIT ${limit}
        `);
        break;
      case 'procedureDocumentName':
        rows = await prisma.$queryRaw<FilterOptionRow[]>(Prisma.sql`
          SELECT MIN(BTRIM(d."name")) AS "value"
          FROM "AssemblyProcedureDocument" AS d
          WHERE BTRIM(d."name") <> ''
            AND d."isActive" = true
            AND (${query} = '' OR STRPOS(LOWER(BTRIM(d."name")), LOWER(${query})) > 0)
          GROUP BY LOWER(BTRIM(d."name"))
          ORDER BY LOWER(MIN(BTRIM(d."name"))) ASC
          LIMIT ${limit}
        `);
        break;
    }

    return rows.map((row) => row.value);
  }
}
