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

export function groupMaterials(materials: ProcedureMaterialDto[], q = ''): MaterialGroup<ProcedureMaterialDto>[] {
  const groups = new Map<string, { title: string; items: ProcedureMaterialDto[] }>();
  const normalizeHint = (hint: string) => hint.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const query = normalizeHint(q).toLowerCase();
  for (const material of materials) {
    const hint = normalizeHint(material.subjectHint ?? '');
    const key = hint ? `hint:${hint}` : '__no_hint__';
    const title = hint ? material.subjectHint! : 'ヒントなし';
    if (query && !normalizeHint(title).toLowerCase().includes(query)) continue;
    const group = groups.get(key) ?? { title, items: [] };
    group.items.push(material);
    groups.set(key, group);
  }
  return [...groups].map(([key, { title, items }]) => {
    items.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const sources = new Set(items.map(materialSource));
    return { key, title, subtitle: `${materialSource(items[0])}${sources.size > 1 ? ' ほか' : ''} · ${dateRange(items)}`, items };
  }).sort((a, b) => a.key === '__no_hint__' ? 1 : b.key === '__no_hint__' ? -1 : Date.parse(b.items[0].receivedAt) - Date.parse(a.items[0].receivedAt));
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
