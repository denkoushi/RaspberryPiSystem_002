import type { SelfInspectionNonconformity } from '../../api/domains/self-inspection-nonconformities';

const contentFields: ReadonlyArray<
  Exclude<keyof SelfInspectionNonconformity, 'id'>
> = [
  'discoveredOn',
  'originDepartmentName',
  'remarks',
  'nonconformityContent',
  'dispositionContent',
  'correctiveContent1',
  'correctiveContent2',
  'partName',
  'machineName'
];

function normalizeDisplayedText(value: string | null): string {
  return (value ?? '').replace(/\r\n?/g, '\n').trim();
}

function displayContentKey(item: SelfInspectionNonconformity): string {
  return JSON.stringify(contentFields.map((field) => normalizeDisplayedText(item[field])));
}

/**
 * Collapses repeated source records into the information an operator needs to
 * read. Every displayed field participates in equality; source identity and
 * non-displayed fields do not. Source records remain individually persisted.
 */
export function collapseNonconformitiesForDisplay(
  items: ReadonlyArray<SelfInspectionNonconformity>
): SelfInspectionNonconformity[] {
  const seen = new Set<string>();
  const collapsed: SelfInspectionNonconformity[] = [];

  for (const item of items) {
    const key = displayContentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    collapsed.push(item);
  }

  return collapsed;
}
