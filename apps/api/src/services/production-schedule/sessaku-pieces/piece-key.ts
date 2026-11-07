import { Prisma, type PrismaClient } from '@prisma/client';
import { ApiError } from '../../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

export type SessakuPieceLogicalKey = { fseiban: string; fhincd: string; fsigencd: string; fkojun: string };
export type SessakuPieceClient = Prisma.TransactionClient | PrismaClient;
export type SessakuPieceSet = Prisma.ProductionScheduleSessakuPieceSetGetPayload<{ include: { pieces: true } }>;
const columns = ['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'] as const;

export function sessakuPieceKeyFromRow(data: unknown): SessakuPieceLogicalKey {
  const row = data as Record<string, unknown>;
  const [fseiban, fhincd, fsigencd, fkojun] = columns.map((column) => String(row?.[column] ?? ''));
  return { fseiban, fhincd, fsigencd, fkojun };
}
export function encodeSessakuPieceKey(key: SessakuPieceLogicalKey): string {
  return JSON.stringify([key.fseiban, key.fhincd, key.fsigencd, key.fkojun]);
}
export function sessakuPieceParentItemId(key: SessakuPieceLogicalKey): string {
  return `row:${Buffer.from(encodeSessakuPieceKey(key)).toString('base64url')}`;
}
export function decodeSessakuPieceParentItemId(value: string): SessakuPieceLogicalKey {
  try {
    if (!value.startsWith('row:')) throw new Error();
    const parts: unknown = JSON.parse(Buffer.from(value.slice(4), 'base64url').toString());
    if (Array.isArray(parts) && parts.length === 5 && typeof parts[0] === 'string' && parts[0].trim() === '********') throw new ApiError(409, '未採番製番は分割できません', undefined, 'UNSUPPORTED_PIECE_PARENT');
    if (!Array.isArray(parts) || parts.length !== 4 || !parts.every((p) => typeof p === 'string' && p.length > 0)) throw new Error();
    const [fseiban, fhincd, fsigencd, fkojun] = parts as string[];
    return { fseiban, fhincd, fsigencd, fkojun };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, '対象アイテムIDが不正です', undefined, 'INVALID_ITEM_ID');
  }
}
export function sessakuPieceSetWhere(key: SessakuPieceLogicalKey) {
  return { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: key.fseiban, fhincd: key.fhincd, fsigencd: key.fsigencd, fkojun: key.fkojun };
}
export async function acquireSessakuPieceLogicalLocks(tx: Prisma.TransactionClient, keys: readonly SessakuPieceLogicalKey[]): Promise<void> {
  for (const encoded of [...new Set((await readRelatedSessakuPieceKeys(tx, keys)).map(encodeSessakuPieceKey))].sort()) {
    const lock = `sessaku-pieces:${PRODUCTION_SCHEDULE_DASHBOARD_ID}:${encoded}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
  }
}
/** Lock every existing set of the same part together, including its cutting source. */
async function readRelatedSessakuPieceKeys(client: SessakuPieceClient, keys: readonly SessakuPieceLogicalKey[]) {
  if (!keys.length) return [];
  const sets = await client.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [...new Map(keys.map(({ fseiban, fhincd }) => [JSON.stringify([fseiban, fhincd]), { fseiban, fhincd }])).values()] }
  });
  return [...keys, ...sets];
}
export async function readSessakuPieceSet(client: SessakuPieceClient, key: SessakuPieceLogicalKey): Promise<SessakuPieceSet | null> {
  return client.productionScheduleSessakuPieceSet.findUnique({
    where: { csvDashboardId_fseiban_fhincd_fsigencd_fkojun: sessakuPieceSetWhere(key) },
    include: { pieces: { orderBy: { position: 'asc' } } }
  });
}
export async function readSessakuPieceSets(client: SessakuPieceClient, rows: readonly { rowData: unknown }[]): Promise<Map<string, SessakuPieceSet>> {
  const keys = new Map(rows.map((row) => { const key = sessakuPieceKeyFromRow(row.rowData); return [encodeSessakuPieceKey(key), key]; }));
  if (!keys.size) return new Map();
  const sets = await client.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: { in: [...new Set([...keys.values()].map((key) => key.fseiban))] } },
    include: { pieces: { orderBy: { position: 'asc' } } }
  });
  return new Map(sets.filter((set) => keys.has(encodeSessakuPieceKey(set))).map((set) => [encodeSessakuPieceKey(set), set]));
}
export async function findSessakuPieceWinner(client: SessakuPieceClient, key: SessakuPieceLogicalKey) {
  const rows = await client.$queryRaw<Array<{ id: string; rowData: Prisma.JsonValue; updatedAt: Date }>>(Prisma.sql`
    SELECT r."id", r."rowData", r."updatedAt" FROM "CsvDashboardRow" r
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND COALESCE(r."rowData"->>'FSEIBAN', '') = ${key.fseiban}
      AND COALESCE(r."rowData"->>'FHINCD', '') = ${key.fhincd}
      AND COALESCE(r."rowData"->>'FSIGENCD', '') = ${key.fsigencd}
      AND COALESCE(r."rowData"->>'FKOJUN', '') = ${key.fkojun}
      AND ${buildMaxProductNoWinnerCondition('r')}
  `);
  return rows[0] ?? null;
}
export async function resolveSessakuPieceItemKeys(client: SessakuPieceClient, itemIds: readonly string[]): Promise<Map<string, SessakuPieceLogicalKey>> {
  const pieceIds = itemIds.filter((id) => id.startsWith('piece:')).map((id) => id.slice(6));
  const pieces = pieceIds.length ? await client.productionScheduleSessakuPiece.findMany({ where: { id: { in: pieceIds } }, include: { pieceSet: true } }) : [];
  const byId = new Map(pieces.map((piece) => [`piece:${piece.id}`, piece.pieceSet]));
  return new Map(itemIds.map((id) => {
    const key = id.startsWith('piece:') ? byId.get(id) : decodeSessakuPieceParentItemId(id);
    if (!key) throw new ApiError(409, '片が更新されています。再読み込みしてください', undefined, 'STALE_SESSAKU_PIECES');
    return [id, key];
  }));
}
export function sessakuPieceConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
    throw new ApiError(409, '片が更新されています。再読み込みしてください', undefined, 'STALE_SESSAKU_PIECES');
  }
  throw error;
}

/** Keep the monotonic sum as a decimal string; a Number loses information above 2^53. */
export async function readSessakuPieceGeneration(client: Pick<SessakuPieceClient, '$queryRaw'>) {
  const [row] = await client.$queryRaw<Array<{ count: bigint; version: bigint }>>`
    SELECT COUNT(*)::bigint AS "count", COALESCE(SUM("version"), 0)::bigint AS "version"
    FROM "ProductionScheduleSessakuPieceSet" WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  `;
  return { count: row.count.toString(), version: row.version.toString() };
}

/** ID replacement/removal touches overrides across sites, including ranks of other parents. */
export async function acquireSessakuPieceBoardStateLocks(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('sessaku-piece-board-states', 0))`;
  await tx.$queryRaw`SELECT "id" FROM "ProductionScheduleGrindingPlanningBoardState"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} ORDER BY "siteKey" FOR UPDATE`;
}
