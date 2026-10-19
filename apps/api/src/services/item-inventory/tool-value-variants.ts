import { normalizeToolValue, type InventoryVariantField, type InventoryVariantGroup } from '@raspi-system/shared-types';

export { normalizeToolValue };
export const VARIANT_FIELDS = ['maker', 'toolName'] as const;
const MAKERS = [
  ['OSG', 'オーエスジー'], ['NACHI', 'ナチ', '不二越'], ['YAMAWA', 'ヤマワ'],
  ['三菱マテリアル', '三菱', 'MITSUBISHI', '三菱日立ツール'], ['MOLDINO', '日立', '日立ツール'],
  ['IWATA', 'イワタ'], ['SUMITOMO', '住友', '住友電工'], ['KYOCERA', '京セラ'],
  ['TUNGALOY', 'タンガロイ'], ['DIJET', 'ダイジェット'], ['YG-1'], ['SANDVIK', 'サンドビック'],
  ['Walter', 'ワルター'], ['Kennametal', 'ケナメタル'],
];
const makerEntry = (value: string) => MAKERS.find(entry => entry.some(alias => normalizeToolValue(alias) === value));
export function sortedValuePair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }
const pairKey = (a: string, b: string) => JSON.stringify(sortedValuePair(a, b));

function distanceOne(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length <= b.length) j++;
    if (a.length >= b.length) i++;
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}
function related(field: InventoryVariantField, a: string, b: string): boolean {
  if (a === b) return true;
  if (field === 'maker') return Boolean(makerEntry(a)?.includes(makerEntry(b)?.[0] ?? ''));
  const simplify = (s: string) => s.replace(/ー$/, '').replace(/([\p{Script=Han}])り(?=[\p{Script=Han}])/gu, '$1');
  return simplify(a) === simplify(b) || distanceOne(a, b);
}

export function suggestVariantGroups(
  field: InventoryVariantField,
  values: Array<{ value: string; count: number }>,
  dismissed: Array<{ field: string; valueA: string; valueB: string }>,
): InventoryVariantGroup[] {
  const excluded = new Set(dismissed.filter(row => row.field === field).map(row => pairKey(row.valueA, row.valueB)));
  const rows = values.filter(row => normalizeToolValue(row.value)).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    const preferred = field === 'maker' ? makerEntry(normalizeToolValue(a.value))?.[0] : undefined;
    if (preferred && makerEntry(normalizeToolValue(b.value))?.[0] === preferred) {
      if (a.value === preferred) return -1;
      if (b.value === preferred) return 1;
    }
    return b.value.length - a.value.length || a.value.localeCompare(b.value, 'ja');
  });
  const clusters: typeof rows[] = [];
  for (const row of rows) {
    // Require every pair to match: a transitive chain must never undo a dismissal.
    const group = clusters.find(cluster => cluster.every(other => !excluded.has(pairKey(row.value, other.value))
      && related(field, normalizeToolValue(row.value), normalizeToolValue(other.value))));
    if (group) group.push(row); else clusters.push([row]);
  }
  return clusters.filter(group => group.length > 1).map(([to, ...from]) => ({
    field, to: to.value, from, auto: from.every(row => normalizeToolValue(row.value) === normalizeToolValue(to.value)),
  }));
}
