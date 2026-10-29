import { normalizeToolValue, sortedValuePair, suggestVariantGroups, VARIANT_FIELDS } from './tool-value-variants.js';
import { splitArea } from '@raspi-system/shelf-layout-core';
import type { InventoryToolScope, InventoryVariantField } from '@raspi-system/shared-types';
import { Prisma, PrismaClient } from '@prisma/client';
import { INVENTORY_OPTION_FIELDS, usedValueWhere, isOfferedValue, compareOptionValues, cleanOptionValue } from './item-inventory.fields.js';
import type { InventoryOptionField } from './item-inventory.fields.js';
import { InventoryConflictError } from './item-inventory.errors.js';

/** The first displayed location owns the scope; imported InventoryItem.area is not a location. */
async function scopedItemWhere(db: PrismaClient | Prisma.TransactionClient, scope: InventoryToolScope): Promise<Prisma.InventoryItemWhereInput> {
  const items = await db.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, compartments: {
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1,
      select: { drawer: { select: { shelf: { select: { area: true } } } } },
    } },
  });
  const ids = items.filter(item => {
    const area = item.compartments[0]?.drawer.shelf.area ?? '';
    return (splitArea(area).machine === '生産技術課' ? 'seigi' : 'default') === scope;
  }).map(item => item.id);
  return { deletedAt: null, id: { in: ids } };
}

/** Pre-registered choices plus values already used, for each field offered in the kiosk pop-up. */
export async function listToolFieldOptions(db: PrismaClient, scope: InventoryToolScope = 'default'): Promise<Record<InventoryOptionField, string[]>> {
  const itemWhere = await scopedItemWhere(db, scope);
  const presets = await db.inventoryToolFieldPreset.findMany({ where: { scope }, select: { field: true, value: true } });
  const entries = await Promise.all(INVENTORY_OPTION_FIELDS.map(async (field) => {
    const rows = await db.inventoryItem.findMany({
      where: { AND: [itemWhere, usedValueWhere(field)] },
      select: { [field]: true },
      distinct: [field],
      orderBy: { [field]: 'asc' },
    }) as unknown as Array<Record<string, string | null>>;
    const used = rows.map((row) => row[field]).filter((value): value is string => isOfferedValue(field, value));
    const preset = presets.filter((entry) => entry.field === field).map((entry) => entry.value);
    return [field, [...new Set([...used, ...preset])].sort(compareOptionValues)] as const;
  }));
  return Object.fromEntries(entries) as Record<InventoryOptionField, string[]>;
}

/** Each field's choices with how many items use them, for the kiosk edit mode. */
export async function listToolFieldValues(db: PrismaClient, scope: InventoryToolScope = 'default'): Promise<Record<InventoryOptionField, Array<{ value: string; count: number }>>> {
  const itemWhere = await scopedItemWhere(db, scope);
  const presets = await db.inventoryToolFieldPreset.findMany({ where: { scope }, select: { field: true, value: true } });
  const entries = await Promise.all(INVENTORY_OPTION_FIELDS.map(async (field) => {
    const groups = await db.inventoryItem.groupBy({
      by: [field],
      where: { AND: [itemWhere, usedValueWhere(field)] },
      _count: { _all: true },
    } as never) as unknown as Array<Record<string, unknown> & { _count: { _all: number } }>;
    const counts = new Map<string, number>();
    for (const group of groups) {
      const value = group[field];
      if (isOfferedValue(field, value)) counts.set(value, group._count._all);
    }
    for (const preset of presets) {
      if (preset.field === field && !counts.has(preset.value)) counts.set(preset.value, 0);
    }
    const values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => compareOptionValues(a.value, b.value));
    return [field, values] as const;
  }));
  return Object.fromEntries(entries) as Record<InventoryOptionField, Array<{ value: string; count: number }>>;
}

export async function addToolFieldValue(db: PrismaClient, field: InventoryOptionField, value: string, scope: InventoryToolScope = 'default') {
  const clean = cleanOptionValue(value);
  await db.inventoryToolFieldPreset.upsert({ where: { scope_field_value: { scope, field, value: clean } }, create: { scope, field, value: clean }, update: {} });
  return { field, value: clean };
}

/** Rename a choice and every item that uses it, in one transaction. */
export async function renameToolFieldValue(db: PrismaClient, field: InventoryOptionField, from: string, to: string, scope: InventoryToolScope = 'default') {
  cleanOptionValue(from);
  // The source is an exact stored spelling (including legacy spaces/full-width text).
  const source = from;
  const target = cleanOptionValue(to);
  if (source === target) return { field, value: target, updatedItems: 0 };
  return db.$transaction(async (tx) => {
    const itemWhere = await scopedItemWhere(tx, scope);
    const result = await tx.inventoryItem.updateMany({ where: { ...itemWhere, [field]: source }, data: { [field]: target } });
    const removed = await tx.inventoryToolFieldPreset.deleteMany({ where: { scope, field, value: source } });
    if (removed.count > 0) {
      await tx.inventoryToolFieldPreset.upsert({ where: { scope_field_value: { scope, field, value: target } }, create: { scope, field, value: target }, update: {} });
    }
    return { field, value: target, updatedItems: result.count };
  });
}

/** Only a choice no item uses can be removed; otherwise it would come back from the items. */
export async function deleteToolFieldValue(db: PrismaClient, field: InventoryOptionField, value: string, scope: InventoryToolScope = 'default') {
  const clean = cleanOptionValue(value);
  const itemWhere = await scopedItemWhere(db, scope);
  const used = await db.inventoryItem.count({ where: { ...itemWhere, [field]: clean } });
  if (used > 0) throw new InventoryConflictError(`「${clean}」は${used}件のアイテムで使っています`);
  await db.inventoryToolFieldPreset.deleteMany({ where: { scope, field, value: clean } });
  return { field, value: clean };
}

export async function toolValueVariants(db: PrismaClient, scope: InventoryToolScope = 'default') {
  const [values, dismissed] = await Promise.all([
    listToolFieldValues(db, scope), db.inventoryToolValueDistinct.findMany({ select: { field: true, valueA: true, valueB: true } }),
  ]);
  let autoMergedValueCount = 0;
  const groups = VARIANT_FIELDS.flatMap(field => {
    const used = values[field].filter(row => row.count > 0);
    autoMergedValueCount += used.length - new Set(used.map(row => normalizeToolValue(row.value))).size;
    return suggestVariantGroups(field, used, dismissed);
  });
  return { groups, autoMergedValueCount };
}

export async function mergeToolValueVariants(
  db: PrismaClient,
  field: InventoryVariantField,
  to: string,
  from: string[],
  scope: InventoryToolScope = 'default',
  rename: (field: InventoryOptionField, from: string, to: string) => ReturnType<typeof renameToolFieldValue> = (field, from, to) => renameToolFieldValue(db, field, from, to, scope),
) {
  let updatedItems = 0;
  for (const value of new Set(from)) {
    if (value !== to) updatedItems += (await rename(field, value, to)).updatedItems;
  }
  return { updatedItems };
}

export async function dismissToolValueVariants(db: PrismaClient, field: InventoryVariantField, values: string[]) {
  const unique = [...new Set(values)];
  const pairs = unique.flatMap((a, index) => unique.slice(index + 1).map(b => {
    const [valueA, valueB] = sortedValuePair(a, b);
    return { field, valueA, valueB };
  }));
  await db.inventoryToolValueDistinct.createMany({ data: pairs, skipDuplicates: true });
  return { dismissed: pairs.length };
}
