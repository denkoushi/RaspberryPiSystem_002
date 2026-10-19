import { ApiError } from '../../lib/errors.js';

/** Optional tool information shown and chosen on the kiosk registration screen. */
export const INVENTORY_TOOL_FIELDS = ['maker', 'toolName', 'workMaterial', 'toolSize'] as const;

export type InventoryToolField = (typeof INVENTORY_TOOL_FIELDS)[number];

export type InventoryToolInput = Partial<Record<InventoryToolField, string>>;

/** Fields that offer a pick list on the kiosk: 名前, the tool fields, 型式 and 用途. */
export const INVENTORY_OPTION_FIELDS = ['name', ...INVENTORY_TOOL_FIELDS, 'model', 'usage'] as const;

export type InventoryOptionField = (typeof INVENTORY_OPTION_FIELDS)[number];

/** The name an item gets when none was typed at registration; it is never offered as a choice. */
export const PROVISIONAL_NAME = /^ItemlistRaspi \d+$/;

/** 名前 is a required column, so it has no null rows to leave out. */
export function usedValueWhere(field: InventoryOptionField) {
  return field === 'name' ? { deletedAt: null } : { deletedAt: null, [field]: { not: null } };
}

export function isOfferedValue(field: InventoryOptionField, value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !(field === 'name' && PROVISIONAL_NAME.test(value));
}

export const TOOL_FIELD_VALUE_MAX_LENGTH = 200;

/** Natural order so that φ20 comes before φ100. */
export function compareOptionValues(a: string, b: string): number {
  return a.localeCompare(b, 'ja', { numeric: true });
}

export function cleanOptionValue(value: string): string {
  const clean = value.normalize('NFKC').trim();
  if (!clean) throw new ApiError(400, '値を入力してください');
  if (clean.length > TOOL_FIELD_VALUE_MAX_LENGTH) throw new ApiError(400, `値は${TOOL_FIELD_VALUE_MAX_LENGTH}文字以内で入力してください`);
  return clean;
}

export function toolData(input: InventoryToolInput, keepMissing: boolean): Partial<Record<InventoryToolField, string | null>> {
  const data: Partial<Record<InventoryToolField, string | null>> = {};
  for (const field of INVENTORY_TOOL_FIELDS) {
    const value = input[field];
    if (value === undefined) {
      if (!keepMissing) data[field] = null;
      continue;
    }
    data[field] = value.normalize('NFKC').trim() || null;
  }
  return data;
}
