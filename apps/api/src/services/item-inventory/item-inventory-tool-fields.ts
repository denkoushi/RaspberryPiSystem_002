import { normalizeToolValue, sortedValuePair, suggestVariantGroups, VARIANT_FIELDS } from './tool-value-variants.js';
import type { InventoryVariantField } from '@raspi-system/shared-types';
import { PrismaClient } from '@prisma/client';
import { INVENTORY_OPTION_FIELDS, usedValueWhere, isOfferedValue, compareOptionValues, cleanOptionValue } from './item-inventory.fields.js';
import type { InventoryOptionField } from './item-inventory.fields.js';
import { InventoryConflictError } from './item-inventory.errors.js';

/** Pre-registered choices plus values already used, for each field offered in the kiosk pop-up. */
export async function listToolFieldOptions(db: PrismaClient): Promise<Record<InventoryOptionField, string[]>> {
  const presets = await db.inventoryToolFieldPreset.findMany({ select: { field: true, value: true } });
  const entries = await Promise.all(INVENTORY_OPTION_FIELDS.map(async (field) => {
    const rows = await db.inventoryItem.findMany({
      where: usedValueWhere(field),
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
export async function listToolFieldValues(db: PrismaClient): Promise<Record<InventoryOptionField, Array<{ value: string; count: number }>>> {
  const presets = await db.inventoryToolFieldPreset.findMany({ select: { field: true, value: true } });
  const entries = await Promise.all(INVENTORY_OPTION_FIELDS.map(async (field) => {
    const groups = await db.inventoryItem.groupBy({
      by: [field],
      where: usedValueWhere(field),
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

export async function addToolFieldValue(db: PrismaClient, field: InventoryOptionField, value: string) {
  const clean = cleanOptionValue(value);
  await db.inventoryToolFieldPreset.upsert({ where: { field_value: { field, value: clean } }, create: { field, value: clean }, update: {} });
  return { field, value: clean };
}

/** Rename a choice and every item that uses it, in one transaction. */
export async function renameToolFieldValue(db: PrismaClient, field: InventoryOptionField, from: string, to: string) {
  cleanOptionValue(from);
  // The source is an exact stored spelling (including legacy spaces/full-width text).
  const source = from;
  const target = cleanOptionValue(to);
  if (source === target) return { field, value: target, updatedItems: 0 };
  return db.$transaction(async (tx) => {
    const result = await tx.inventoryItem.updateMany({ where: { deletedAt: null, [field]: source }, data: { [field]: target } });
    const removed = await tx.inventoryToolFieldPreset.deleteMany({ where: { field, value: source } });
    if (removed.count > 0) {
      await tx.inventoryToolFieldPreset.upsert({ where: { field_value: { field, value: target } }, create: { field, value: target }, update: {} });
    }
    return { field, value: target, updatedItems: result.count };
  });
}

/** Only a choice no item uses can be removed; otherwise it would come back from the items. */
export async function deleteToolFieldValue(db: PrismaClient, field: InventoryOptionField, value: string) {
  const clean = cleanOptionValue(value);
  const used = await db.inventoryItem.count({ where: { deletedAt: null, [field]: clean } });
  if (used > 0) throw new InventoryConflictError(`「${clean}」は${used}件のアイテムで使っています`);
  await db.inventoryToolFieldPreset.deleteMany({ where: { field, value: clean } });
  return { field, value: clean };
}

export async function toolValueVariants(db: PrismaClient) {
  const [values, dismissed] = await Promise.all([
    listToolFieldValues(db), db.inventoryToolValueDistinct.findMany({ select: { field: true, valueA: true, valueB: true } }),
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
  rename: (field: InventoryOptionField, from: string, to: string) => ReturnType<typeof renameToolFieldValue> = (field, from, to) => renameToolFieldValue(db, field, from, to),
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
