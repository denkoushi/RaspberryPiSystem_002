import { sourceFingerprint } from './business-hermes-answer-cache.js';

type Ref = { kind: string; id: string; sha256: string };
export type SourceFact = { version: 1; scope: string; subject: string };
export type FactCase = { question: string; queries: string[]; answer: string; sources: Ref[]; fact: SourceFact;
  review: { verdict: string; reviewer: string; reason: string; reviewedAt: string } };
const label = (v: unknown): v is string => typeof v === 'string' && /^[\p{L}\p{N}_.\-/ ]{1,60}$/u.test(v) && v.trim() === v;
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();

/** Bounded whole-record quotations. No model or user correctness vote enters this producer. */
export function prepareSourceFact(detail: unknown, ref: Ref, now: string): FactCase | null {
  const response = detail as { isError?: boolean; content?: Array<{ type: string; text: string }> };
  if (response?.isError || response?.content?.[0]?.type !== 'text' || sourceFingerprint(detail) !== ref.sha256) return null;
  const r = JSON.parse(response.content[0].text) as Record<string, unknown>;
  if (r.kind !== ref.kind || r.id !== ref.id || !label(r.partNumber)) return null;
  let scope: string, subject: string, answer: string;
  if (r.kind === 'nonconformity') {
    if (!label(r.nonconformityNo) || (r.provenance as { activeLatest?: boolean } | undefined)?.activeLatest !== true) return null;
    const fields = [['condition', '不適合内容'], ['remarks', '備考'], ['disposition', '処置内容'], ['correctiveContent', '個別是正内容'],
      ['partName', '品名'], ['machineName', '機械名'], ['originDepartmentCode', '起因部署コード'], ['originDepartmentName', '起因部署名'],
      ['discoveredOn', '発見日'], ['sourceVersionDate', '元データ更新日']];
    if (fields.some(([key]) => r[key!] != null && typeof r[key!] !== 'string') || !fields.slice(0, 4).some(([key]) => text(r[key!]))) return null;
    scope = `不適合記録${r.nonconformityNo}・図番${r.partNumber}`;
    subject = '記録内容';
    answer = `${scope}\n過去記録の引用であり、現在の作業指示ではありません。\n` + fields.map(([key, name]) => `${name}：${text(r[key!]) ? r[key!] : '未記録'}`).join('\n');
  } else if (r.kind === 'work_instruction') {
    if (r.public !== true || !label(r.shootingTarget) || !Array.isArray(r.rows) || r.rows.length !== 1) return null;
    const row = r.rows[0] as { sourceVersionDate?: string; publication?: { publishedVersionId?: string }; steps?: Array<{ step: number; effectiveText: string }> };
    if (!row.publication?.publishedVersionId || !text(row.sourceVersionDate) || !row.steps?.length || row.steps.some(s => !Number.isSafeInteger(s.step) || s.step < 1 || !text(s.effectiveText))
      || new Set(row.steps.map(s => s.step)).size !== row.steps.length || row.steps.some((s, i) => i > 0 && s.step <= row.steps![i - 1]!.step)) return null;
    scope = `図番${r.partNumber}・対象${r.shootingTarget}の公開要領`;
    subject = '記載本文';
    answer = `${scope}\n公開された本文の引用です。画像等は元資料で確認してください。\n元データ更新日：${row.sourceVersionDate}\n` + row.steps.map(s => `手順${s.step}：${s.effectiveText}`).join('\n');
  } else return null;
  const question = `${scope}の${subject}は？`;
  if (question.length > 100 || answer.length > 4000) return null;
  return { question, queries: [question], answer, sources: [ref], fact: { version: 1, scope, subject },
    review: { verdict: 'pass', reviewer: 'source-fact-v1', reason: '出典の全項目・本文を引用。独立した事実照合後のみ採用。', reviewedAt: now } };
}
