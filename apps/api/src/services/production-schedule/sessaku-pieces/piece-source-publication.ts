import type { Prisma, PrismaClient } from '@prisma/client';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { encodeSessakuPieceKey, readSessakuPieceSets, sessakuPieceKeyFromRow, type SessakuPieceSet } from './piece-key.js';
import { prepareSessakuPiecePublication, publishSessakuPieceProgress } from './piece-sync.js';

/** Publish live piece parents atomically; keep the original create path for ordinary rows. */
export async function publishSessakuPieceSourceCreates(client: PrismaClient, rows: readonly Prisma.CsvDashboardRowCreateManyInput[], options: {
  collectCreatedRows?: boolean; pieceSets?: ReadonlyMap<string, SessakuPieceSet>;
} = {}) {
  const sets = options.pieceSets ?? await readSessakuPieceSets(client, rows);
  const published: Array<{ rowId: string; rowData: Prisma.JsonValue; occurredAt: Date }> = [];
  const hasPieces = (row: typeof rows[number]) => Boolean(sets.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)))?.pieces.length);
  if (!rows.some(hasPieces)) {
    if (options.collectCreatedRows === false) await client.csvDashboardRow.createMany({ data: [...rows] });
    else for (const row of rows) {
      const created = await client.csvDashboardRow.create({ data: row, select: { id: true } });
      published.push({ rowId: created.id, rowData: row.rowData as Prisma.JsonValue, occurredAt: row.occurredAt as Date });
    }
    return published;
  }
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    if (!chunk.some(hasPieces)) {
      published.push(...await publishSessakuPieceSourceCreates(client, chunk, { ...options, pieceSets: sets }));
      continue;
    }
    published.push(...await client.$transaction(async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      const states = await prepareSessakuPiecePublication(tx, chunk);
      const createdRows = [];
      for (const row of chunk) {
        const created = await tx.csvDashboardRow.create({ data: row, select: { id: true, occurredAt: true } });
        createdRows.push({ rowId: created.id, rowData: row.rowData as Prisma.JsonValue, occurredAt: created.occurredAt });
      }
      await publishSessakuPieceProgress(tx, states);
      return createdRows;
    }, { timeout: 30000, maxWait: 15000 }));
  }
  return published;
}
