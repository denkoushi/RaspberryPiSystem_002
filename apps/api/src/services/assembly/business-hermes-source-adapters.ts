/** Table-specific fields stop here. Learning/search use SourceDocument only. */
export type SourceDocument = {
  kind: string; id: string; title: string; text: string; identifiers: string[];
};
type SourceAdapter = {
  cursorKey: string; sourceKey: string;
  project: (record: Record<string, unknown>) => { title: string; answerScope: string; searchText: string; evidence: Record<string, unknown>; identifiers: string[] };
};
export const businessSourceAdapters: Readonly<Record<string, SourceAdapter>> = {
  nonconformity: {
    cursorKey: 'nonconformityOffset', sourceKey: 'nonconformity',
    project: (r) => ({
      answerScope: '記録' + r.nonconformityNo,
      searchText: ['nonconformityNo', 'partNumber', 'condition', 'remarks', 'correctiveContent'].map((k) => String(r[k] || '')).join('\n'),
      title: '記録' + r.nonconformityNo + '：' + (r.remarks || r.condition || '記録の内容'),
      evidence: Object.fromEntries(['kind', 'id', 'nonconformityNo', 'partNumber', 'condition', 'remarks', 'correctiveContent', 'disposition'].map((k) => [k, r[k]])),
      identifiers: [String(r.partNumber || ''), String(r.nonconformityNo || '')].filter(Boolean)
    })
  },
  work_instruction: {
    cursorKey: 'workInstructionOffset', sourceKey: 'workInstruction',
    project: (r) => ({
      answerScope: '公開要領：' + r.partNumber + '・' + r.shootingTarget,
      searchText: [r.partNumber, r.shootingTarget, ...(r.rows as Array<{ steps: Array<{ effectiveText: string }> }>).flatMap((row) => row.steps.map((s) => s.effectiveText))].join('\n'),
      title: '公開要領：' + r.partNumber + '・' + r.shootingTarget,
      evidence: { kind: r.kind, id: r.id, partNumber: r.partNumber, shootingTarget: r.shootingTarget,
        steps: (r.rows as Array<{ steps: Array<{ step: number; effectiveText: string }> }>).flatMap((row) => row.steps.map((s) => ({ step: s.step, text: s.effectiveText }))) },
      identifiers: [String(r.partNumber || '')].filter(Boolean)
    })
  }
};

export function projectBusinessSource(record: Record<string, unknown>) {
  const kind = String(record.kind);
  if (!Object.hasOwn(businessSourceAdapters, kind) || typeof record.id !== 'string') throw new Error('Unsupported business source');
  return businessSourceAdapters[kind]!.project(record);
}

export function sourceDocument(record: Record<string, unknown>): SourceDocument {
  const projected = projectBusinessSource(record);
  return { kind: String(record.kind), id: String(record.id), title: projected.title.replace(/\s+/g, ' ').slice(0, 100),
    text: projected.searchText, identifiers: projected.identifiers };
}
