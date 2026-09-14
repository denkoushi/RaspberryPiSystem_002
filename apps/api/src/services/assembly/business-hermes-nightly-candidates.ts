import { z } from 'zod';
import { sourceFingerprint } from './business-hermes-answer-cache.js';
import type { SourceDocument } from './business-hermes-source-adapters.js';

export const documentAttemptsSchema = z.record(z.object({ sha256: z.string(), attemptedAt: z.number() }));
export type DocumentAttempts = z.infer<typeof documentAttemptsSchema>;
type SourceRef = { kind: string; id: string };

export const evaluationSchema = z.object({
  version: z.literal(1),
  cases: z.array(z.object({
    id: z.string().min(1), question: z.string().trim().min(1).max(4000),
    expectedSource: z.object({ kind: z.string(), id: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
    requiredFragments: z.array(z.string().min(1)).optional(),
    forbiddenFragments: z.array(z.string().min(1)).optional()
  })).min(4).max(200)
});

export function normalizeNightQuestion(question: string) {
  return question.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** A conservative lexical guard, not a claim of semantic equivalence. Mirrored by maintenance.py. */
export function overlapsNightQuestion(question: string, protectedQuestions: string[]) {
  const normalized = normalizeNightQuestion(question);
  const grams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 2) }, (_, i) => value.slice(i, i + 3)));
  const left = grams(normalized);
  return protectedQuestions.some(value => {
    const other = normalizeNightQuestion(value);
    if (normalized === other || (Math.min(normalized.length, other.length) >= 8
      && (normalized.includes(other) || other.includes(normalized)))) return true;
    const right = grams(other);
    const union = new Set([...left, ...right]);
    return union.size > 0 && [...left].filter(g => right.has(g)).length / union.size >= .8;
  });
}

export function questionNumbers(text: string) {
  return new Set(text.normalize('NFKC').toLowerCase().match(/[a-z]*\d+(?:[.-]\d+)*[a-z]*/g) || []);
}

export function validateDocumentQuestion(question: string, identifiers: string[], evidence: unknown, excluded: string[]) {
  const parsed = z.string().trim().min(8).max(100).safeParse(question);
  if (!parsed.success) return 'invalid_question';
  const text = question.normalize('NFKC').toLowerCase();
  if (!identifiers.length || identifiers.some(id => !text.includes(id.normalize('NFKC').toLowerCase()))) return 'missing_source_identity';
  const numbers = questionNumbers(JSON.stringify(evidence));
  if ([...questionNumbers(question)].some(n => !numbers.has(n))) return 'unsupported_number';
  if (overlapsNightQuestion(question, excluded)) return 'duplicate_or_protected';
  return null;
}

export function selectNightDocuments(documents: SourceDocument[], cases: Array<{ sources: SourceRef[] }>,
  events: Array<{ sources: SourceRef[]; verdict: string }>, attempts: DocumentAttempts, now: number) {
  const covered = new Set(cases.flatMap(c => c.sources.map(s => s.kind + ':' + s.id)));
  const demand = new Map<string, number>();
  for (const event of events) for (const ref of event.sources) {
    const key = ref.kind + ':' + ref.id;
    demand.set(key, (demand.get(key) || 0) + (event.verdict === 'unhelpful' ? 10 : 1));
  }
  return documents.map(document => {
    const key = document.kind + ':' + document.id;
    const sha256 = sourceFingerprint(document);
    const last = attempts[key];
    const changed = last && last.sha256 !== sha256;
    return { document, key, sha256, last: last?.attemptedAt || 0,
      eligible: !last || changed || now - last.attemptedAt >= 7 * 24 * 60 * 60_000,
      priority: (changed ? 100 : 0) + (demand.get(key) || 0) + (!covered.has(key) ? 5 : 0) };
  }).filter(item => item.eligible && item.document.text.trim())
    .sort((a, b) => b.priority - a.priority || a.last - b.last || a.key.localeCompare(b.key))
    .slice(0, 4);
}
