import type { ProcedureMaterialDto, ProcedureWorkInstructionCandidate } from './procedure-material-types';

export type MaterialGroup<T> = { key: string; title: string; subtitle: string; items: T[] };

export function materialSource(material: ProcedureMaterialDto): string {
  return material.origin === 'WORK_INSTRUCTION' ? '加工' : material.origin === 'KNOWLEDGE' ? 'ナレッジ' : 'メール';
}

function dateRange(items: ProcedureMaterialDto[]): string {
  const newest = new Date(items[0].receivedAt);
  const oldest = new Date(items[items.length - 1].receivedAt);
  const date = (value: Date) => value.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (oldest.getTime() === newest.getTime()) return date(newest);
  const sameDay = oldest.toDateString() === newest.toDateString();
  return `${date(oldest)}〜${sameDay ? newest.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : date(newest)}`;
}

const newest = (items: ProcedureMaterialDto[]) => Math.max(...items.map((item) => Date.parse(item.receivedAt)));

export function groupMaterials(materials: ProcedureMaterialDto[], q = ''): MaterialGroup<ProcedureMaterialDto>[] {
  const groups = new Map<string, { title: string; items: ProcedureMaterialDto[] }>();
  const normalizeHint = (hint: string) => hint.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const stripPartSuffix = (hint: string) => hint.replace(/\s+\S+\s*$/, (suffix) =>
    /^\s+\(p?\d+\/\d+\)\s*$/.test(suffix.normalize('NFKC')) ? '' : suffix);
  const query = normalizeHint(q).toLowerCase();
  for (const material of materials) {
    const hint = stripPartSuffix(normalizeHint(material.subjectHint ?? ''));
    const fileBase = (material.originalFileName ?? '').replace(/\.[^.]+$/, '').replace(/\s+p\d+\s*$/, '');
    const normalizedFileBase = normalizeHint(fileBase);
    const key = hint ? `hint:${hint}` : normalizedFileBase ? `file:${normalizedFileBase}` : '__no_hint__';
    const title = hint ? stripPartSuffix(material.subjectHint!) : normalizedFileBase ? fileBase : 'ヒントなし';
    const group = groups.get(key) ?? { title, items: [] };
    group.items.push(material);
    groups.set(key, group);
  }
  return [...groups].filter(([, { title }]) => !query || normalizeHint(title).toLowerCase().includes(query)).map(([key, { title, items }]) => {
    type Unit = { items: { material: ProcedureMaterialDto; number: number }[]; receivedAt: number };
    const units: Unit[] = [];
    const sequences = new Map<string, Unit>();
    for (const material of items) {
      const match = material.gmailDedupeKey?.match(/^(.+):p?(\d+)$/);
      const parent = material.kind === 'PDF' ? material.gmailDedupeKey : match?.[1];
      const number = material.kind === 'PDF' ? 0 : match ? Number(match[2]) : 0;
      const receivedAt = Date.parse(material.receivedAt);
      let unit = parent ? sequences.get(parent) : undefined;
      if (!unit) {
        unit = { items: [], receivedAt };
        units.push(unit);
        if (parent) sequences.set(parent, unit);
      }
      unit.items.push({ material, number });
      unit.receivedAt = Math.max(unit.receivedAt, receivedAt);
    }
    units.sort((a, b) => b.receivedAt - a.receivedAt);
    const sortedItems = units.flatMap((unit) => unit.items.sort((a, b) => a.number - b.number).map(({ material }) => material));
    const sources = new Set(sortedItems.map(materialSource));
    const byReceipt = [...items].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    return { key, title, subtitle: `${materialSource(sortedItems[0])}${sources.size > 1 ? ' ほか' : ''} · ${dateRange(byReceipt)}`, items: sortedItems };
  }).sort((a, b) => a.key === '__no_hint__' ? 1 : b.key === '__no_hint__' ? -1 : newest(b.items) - newest(a.items));
}

export function groupWorkInstructionCandidates(candidates: ProcedureWorkInstructionCandidate[], q = ''): MaterialGroup<ProcedureWorkInstructionCandidate>[] {
  const groups = new Map<string, ProcedureWorkInstructionCandidate[]>();
  const query = q.normalize('NFKC').trim().toLowerCase();
  for (const candidate of candidates) {
    if (query && ![candidate.partNumber, candidate.shootingTarget].some((value) => value.normalize('NFKC').toLowerCase().includes(query))) continue;
    const items = groups.get(candidate.partNumber) ?? [];
    items.push(candidate);
    groups.set(candidate.partNumber, items);
  }
  return [...groups].map(([title, items]) => {
    items.sort((a, b) => a.shootingTarget.localeCompare(b.shootingTarget, 'ja') || a.step - b.step);
    const steps = items.map((item) => item.step);
    return { key: title, title, subtitle: `撮影対象 ${new Set(items.map((item) => item.shootingTarget)).size} · 手順 ${Math.min(...steps)}〜${Math.max(...steps)}`, items };
  });
}
