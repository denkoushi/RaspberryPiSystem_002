import { Prisma } from '@prisma/client';

/** Shared by the SQL aggregate and the lightweight fallback row reader. */
export const SESSAKU_PIECE_LOAD_JOINS_SQL = Prisma.sql`
  LEFT JOIN "ProductionScheduleSessakuPieceSet" ps ON ps."csvDashboardId" = "CsvDashboardRow"."csvDashboardId"
    AND ps."fseiban" = COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')
    AND ps."fhincd" = COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')
    AND ps."fsigencd" = COALESCE("CsvDashboardRow"."rowData"->>'FSIGENCD', '')
    AND ps."fkojun" = COALESCE("CsvDashboardRow"."rowData"->>'FKOJUN', '')
  LEFT JOIN "ProductionScheduleSessakuPiece" pc ON pc."pieceSetId" = ps."id"
`;
