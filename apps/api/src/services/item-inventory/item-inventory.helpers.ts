import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { normalizeInventoryUnit } from './inventory-area.js';

export const UNIT_NAME_MAX_LENGTH = 20;

export const COMPARTMENT_LOOKUP_INCLUDE = {
  drawer: { include: { shelf: true } },
  inventoryItem: { include: { photos: { orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }] } } },
  itemTag: true,
} satisfies Prisma.InventoryCompartmentInclude;

export const TRANSACTION_INCLUDE = {
  inventoryItem: true,
  compartment: { include: { drawer: { include: { shelf: true } } } },
} satisfies Prisma.InventoryTransactionInclude;

export function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, `${label}は1以上の整数で指定してください`);
  return value;
}

export function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, `${label}は0以上の整数で指定してください`);
  return value;
}

export function newItemCode(sourceItemId: number): string {
  return `RI-${sourceItemId}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function locationDto(compartment: {
  id: string;
  labelNumber: number;
  stockQuantity: number;
  drawer: { drawerNumber: number; shelf: { area: string; shelfNumber: number } };
  itemTag: { uid: string } | null;
  inventoryItem: { id: string; itemCode: string; name: string; model: string | null; usage: string | null; category: string | null; area: string | null; note: string | null; unit?: string | null; unitPrice?: number | null; maker?: string | null; toolName?: string | null; workMaterial?: string | null; toolSize?: string | null; photos?: Array<{ id: string; photoIndex: number; photoUrl: string; originalFilename: string }> };
}) {
  return {
    id: compartment.id,
    labelNumber: compartment.labelNumber,
    stockQuantity: compartment.stockQuantity,
    area: compartment.drawer.shelf.area,
    shelfNumber: compartment.drawer.shelf.shelfNumber,
    drawerNumber: compartment.drawer.drawerNumber,
    itemTagUid: compartment.itemTag?.uid ?? null,
    item: {
      id: compartment.inventoryItem.id,
      itemCode: compartment.inventoryItem.itemCode,
      name: compartment.inventoryItem.name,
      model: compartment.inventoryItem.model,
      usage: compartment.inventoryItem.usage,
      category: compartment.inventoryItem.category,
      area: compartment.inventoryItem.area,
      note: compartment.inventoryItem.note,
      unit: compartment.inventoryItem.unit ?? null,
      unitPrice: compartment.inventoryItem.unitPrice ?? null,
      maker: compartment.inventoryItem.maker ?? null,
      toolName: compartment.inventoryItem.toolName ?? null,
      workMaterial: compartment.inventoryItem.workMaterial ?? null,
      toolSize: compartment.inventoryItem.toolSize ?? null,
      photos: compartment.inventoryItem.photos ?? [],
    },
  };
}

export async function assertNfcUidAvailable(uid: string, db: PrismaClient | Prisma.TransactionClient): Promise<void> {
  const [employee, item, measuringInstrumentTag, riggingGearTag] = await Promise.all([
    db.employee.findFirst({ where: { nfcTagUid: uid }, select: { id: true } }),
    db.item.findFirst({ where: { nfcTagUid: uid }, select: { id: true } }),
    db.measuringInstrumentTag.findFirst({ where: { rfidTagUid: uid }, select: { id: true } }),
    db.riggingGearTag.findFirst({ where: { rfidTagUid: uid }, select: { id: true } }),
  ]);
  if (employee || item || measuringInstrumentTag || riggingGearTag) {
    throw new ApiError(409, 'このUIDは既存の社員・工具・計測機器・玉掛け具で使用中です');
  }
}

export async function runSerializable<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('unreachable');
}

/** A unit must be one of the offered units; null returns the item to 個. */
export async function resolveUnit(db: PrismaClient, unit: string | null): Promise<string | null> {
  if (unit === null) return null;
  const clean = normalizeInventoryUnit(unit);
  if (!clean) return null;
  const known = await db.inventoryUnit.findUnique({ where: { name: clean } });
  if (!known) throw new ApiError(400, `単位「${clean}」は登録されていません`);
  return clean;
}
