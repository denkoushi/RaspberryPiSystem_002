type JsonRecord = Record<string, unknown>;

export type ConsultationEvidence = {
  kind: 'nonconformity' | 'work_instruction';
  id: string;
  title: string;
  partNumber: string;
  originDepartmentCode?: string | null;
  originDepartmentName?: string | null;
  originDepartmentMeaning?: string;
  shootingTarget?: string;
  step?: number;
  sourceStep?: number;
  text: string;
  effectiveText?: string;
  sourceVersionDate?: string;
  source?: Record<string, unknown>;
  sourceUrl?: string;
  publishedVersionId?: string;
  publishedVersionCreatedAt?: string;
  publishedRevisionId?: string | null;
  publishedRevisionCreatedAt?: string | null;
  rawImageLabel?: string;
  imageAssetId?: string;
  imageUrl?: string;
  imageMimeType?: string;
  displayFields?: {
    summary: Array<{ key: string; label: string; value: string }>;
    detail: Array<{ key: string; label: string; value: string }>;
  };
};

export const MAX_EVIDENCE = 24;

export function asEvidenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => /^(?:nonconformity|work_instruction):.+$/.test(entry)))]
    .slice(0, MAX_EVIDENCE);
}

export function requestedRecordIds(value: unknown): { ids: string[]; invalid: boolean } {
  if (value === null) return { ids: [], invalid: false };
  if (!Array.isArray(value)) return { ids: [], invalid: true };
  const ids = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
  return {
    ids,
    invalid: ids.length !== value.length
      || ids.some((id) => !/^(?:nonconformity|work_instruction):.+$/.test(id))
      || new Set(ids).size !== ids.length
      || ids.length > MAX_EVIDENCE
  };
}

export function evidenceKey(evidence: Pick<ConsultationEvidence, 'kind' | 'id'>): string {
  return `${evidence.kind}:${evidence.id}`;
}

function displayFields(value: unknown): ConsultationEvidence['displayFields'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  const parse = (fields: unknown) => Array.isArray(fields)
    ? fields.flatMap((field) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) return [];
      const candidate = field as JsonRecord;
      return typeof candidate.key === 'string' && typeof candidate.label === 'string' && typeof candidate.value === 'string'
        ? [{ key: candidate.key.slice(0, 80), label: candidate.label.slice(0, 80), value: candidate.value }]
        : [];
    }).slice(0, 16)
    : [];
  const summary = parse(record.summary);
  const detail = parse(record.detail);
  return summary.length > 0 || detail.length > 0 ? { summary, detail } : undefined;
}

function displayValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function displayField(key: string, label: string, value: unknown, maxLength?: number): { key: string; label: string; value: string } | null {
  const normalized = displayValue(value);
  if (!normalized) return null;
  const valueWithLimit = maxLength && normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
  return { key, label, value: valueWithLimit };
}

function projectDisplayFields(input: {
  item: JsonRecord;
  kind: ConsultationEvidence['kind'];
  partNumber: string;
  step?: number;
  text: string;
}): ConsultationEvidence['displayFields'] | undefined {
  const existing = displayFields(input.item.displayFields);
  if (existing) return existing;
  const summary = input.kind === 'nonconformity'
    ? [
      displayField('nonconformityNo', '不適合番号', input.item.nonconformityNo),
      displayField('partNumber', '品番', input.partNumber),
      displayField('partName', '品名', input.item.partName),
      displayField('machineName', '機械名', input.item.machineName),
      displayField('discoveredOn', '発見日', input.item.discoveredOn),
      displayField('condition', '不適合内容', input.item.condition, 240),
      displayField('originDepartmentName', '起因部署', input.item.originDepartmentName)
    ]
    : [
      displayField('partNumber', '品番', input.partNumber),
      displayField('shootingTarget', '対象', input.item.shootingTarget),
      displayField('step', '手順', input.step),
      displayField('text', '要点', input.item.effectiveText ?? input.item.text ?? input.text, 240),
    ];
  const detail = input.kind === 'nonconformity'
    ? [
      displayField('condition', '不適合内容', input.item.condition),
      displayField('remarks', '備考', input.item.remarks),
      displayField('disposition', '処置', input.item.disposition),
      displayField('correctiveContent', '個別是正', input.item.correctiveContent)
    ]
    : [displayField('text', '要領内容', input.item.effectiveText ?? input.item.text ?? input.text)];
  const summaryFields = summary.filter((field): field is { key: string; label: string; value: string } => Boolean(field));
  const detailFieldsByKey = new Map(detail.filter((field): field is { key: string; label: string; value: string } => Boolean(field)).map((field) => [field.key, field]));
  const detailFields = summaryFields.map((field) => detailFieldsByKey.get(field.key) ?? field);
  for (const field of detailFieldsByKey.values()) {
    if (!summaryFields.some((summaryField) => summaryField.key === field.key)) detailFields.push(field);
  }
  return summaryFields.length > 0 || detailFields.length > 0 ? { summary: summaryFields, detail: detailFields } : undefined;
}

export function rawEvidenceKey(value: JsonRecord): string | null {
  const kind = value.kind === 'work_instruction' || value.kind === 'work-instruction'
    ? 'work_instruction' : value.kind === 'nonconformity' ? 'nonconformity' : null;
  const id = typeof value.id === 'string' ? value.id : typeof value.evidence_id === 'string' ? value.evidence_id : null;
  return kind && id ? `${kind}:${id}` : null;
}

export function mergeEvidence(...groups: ReadonlyArray<ReadonlyArray<ConsultationEvidence>>): ConsultationEvidence[] {
  const seen = new Set<string>();
  const merged: ConsultationEvidence[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = evidenceKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}


export function projectTrustedEvidence(raw: ReadonlyArray<JsonRecord>, activeAssetIds: ReadonlySet<string>): ConsultationEvidence[] {
  const seen = new Set<string>();
  const result: ConsultationEvidence[] = [];
  for (const item of raw) {
    const kind = item.kind === 'work_instruction' || item.kind === 'work-instruction' ? 'work_instruction' : item.kind === 'nonconformity' ? 'nonconformity' : null;
    const id = typeof item.id === 'string' ? item.id : typeof item.evidence_id === 'string' ? item.evidence_id : null;
    const partNumber = typeof item.partNumber === 'string' ? item.partNumber : typeof item.part_number === 'string' ? item.part_number : '';
    if (!kind || !id || seen.has(`${kind}:${id}`)) continue;
    const stepRaw = item.step ?? item.sourceStep ?? item.source_step;
    const step = typeof stepRaw === 'number' && Number.isSafeInteger(stepRaw) ? stepRaw : typeof stepRaw === 'string' && /^\d+$/.test(stepRaw) ? Number(stepRaw) : undefined;
    const imageAssetId = typeof item.imageAssetId === 'string' ? item.imageAssetId : typeof item.asset_id === 'string' ? item.asset_id : undefined;
    const textValue = typeof item.effectiveText === 'string' ? item.effectiveText
      : typeof item.text === 'string' ? item.text
        : [item.condition, item.remarks, item.correctiveContent, item.disposition].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '';
    if (!textValue && !partNumber) continue;
    seen.add(`${kind}:${id}`);
    const sourceVersionDate = typeof item.sourceVersionDate === 'string' ? item.sourceVersionDate : typeof item.source_version_date === 'string' ? item.source_version_date : undefined;
    const source = item.source && typeof item.source === 'object' ? item.source as Record<string, unknown> : undefined;
    const publication = item.publication && typeof item.publication === 'object' ? item.publication as JsonRecord : undefined;
    const publishedVersionId = typeof item.publishedVersionId === 'string' ? item.publishedVersionId : typeof publication?.publishedVersionId === 'string' ? publication.publishedVersionId : undefined;
    const publishedVersionCreatedAt = typeof item.publishedVersionCreatedAt === 'string' ? item.publishedVersionCreatedAt : typeof publication?.publishedVersionCreatedAt === 'string' ? publication.publishedVersionCreatedAt : undefined;
    const publishedRevisionId = typeof item.publishedRevisionId === 'string' ? item.publishedRevisionId : typeof publication?.publishedRevisionId === 'string' ? publication.publishedRevisionId : null;
    const publishedRevisionCreatedAt = typeof item.publishedRevisionCreatedAt === 'string' ? item.publishedRevisionCreatedAt : typeof publication?.publishedRevisionCreatedAt === 'string' ? publication.publishedRevisionCreatedAt : null;
    const sourceUrl = kind === 'work_instruction' && partNumber && typeof item.shootingTarget === 'string' && item.shootingTarget
      ? `/kiosk/part-measurement/self-inspection?partNumber=${encodeURIComponent(partNumber)}&shootingTarget=${encodeURIComponent(item.shootingTarget)}`
      : undefined;
    const projectedDisplayFields = projectDisplayFields({ item, kind, partNumber, step, text: textValue });
    result.push({
      kind,
      id,
      title: typeof item.title === 'string' ? item.title : typeof item.nonconformityNo === 'string' ? item.nonconformityNo : kind === 'work_instruction' ? '公開作業要領' : '不適合',
      partNumber,
      ...(kind === 'nonconformity' ? {
        originDepartmentCode: typeof item.originDepartmentCode === 'string' ? item.originDepartmentCode : null,
        originDepartmentName: typeof item.originDepartmentName === 'string' ? item.originDepartmentName : null,
        originDepartmentMeaning: '起因部署'
      } : {}),
      shootingTarget: typeof item.shootingTarget === 'string' ? item.shootingTarget : undefined,
      step,
      sourceStep: step,
      text: textValue.slice(0, 1_500),
      effectiveText: typeof item.effectiveText === 'string' ? item.effectiveText.slice(0, 1_500) : undefined,
      ...(projectedDisplayFields ? { displayFields: projectedDisplayFields } : {}),
      sourceVersionDate,
      source,
      sourceUrl,
      ...(publishedVersionId ? { publishedVersionId } : {}),
      ...(publishedVersionCreatedAt ? { publishedVersionCreatedAt } : {}),
      ...(publishedRevisionId !== undefined ? { publishedRevisionId } : {}),
      ...(publishedRevisionCreatedAt !== undefined ? { publishedRevisionCreatedAt } : {}),
      ...(imageAssetId && activeAssetIds.has(imageAssetId) ? { rawImageLabel: '元写真（公開作業要領）' } : {}),
      ...(imageAssetId && activeAssetIds.has(imageAssetId) ? {
        imageAssetId,
        imageUrl: `/api/work-instructions/assets/${imageAssetId}`,
        imageMimeType: typeof item.imageMimeType === 'string' ? item.imageMimeType : undefined
      } : {})
    });
    if (result.length >= MAX_EVIDENCE) break;
  }
  return result;
}
