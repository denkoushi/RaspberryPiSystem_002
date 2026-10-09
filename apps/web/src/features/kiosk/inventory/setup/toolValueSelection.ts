import type { InventoryOptionField } from '../../../../api/client';

export function splitToolValues(value: string): string[] {
  return [...new Set(value.split('・').map((part) => part.trim()).filter(Boolean))];
}

export function joinToolValues(values: string[]): string {
  return splitToolValues(values.join('・')).join('・');
}

export function toolValueOptions(field: InventoryOptionField, values: string[]): string[] {
  return [...new Set(field === 'name' ? values : values.flatMap(splitToolValues))];
}

export function toggleToolValue(field: InventoryOptionField, current: string, value: string): string {
  if (field === 'name') return current === value ? '' : value;
  const selected = splitToolValues(current);
  return joinToolValues(selected.includes(value) ? selected.filter((part) => part !== value) : [...selected, value]);
}
