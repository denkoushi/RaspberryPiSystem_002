import type { KnowledgeProcedureReviewTier, KnowledgeProcedureSource, KnowledgeProcedureStep } from '@raspi-system/shared-types';

import type { ProcedureMaterial } from './procedure-material.port.js';
import { composeTitle, procedureContentSchema, titlePartsSchema, type ProcedureContent, type ProcedureHeader, type TitleParts } from './procedure-content.js';
import type { ProcedureIdentifiers, TriageSuggestions } from './triage.port.js';

/** What the model sees of one material. Built by code; the model never sees storage keys. */
export type MaterialDigest = {
  id: string;
  title: string;
  summary: string;
  text: string;
  capturedAt: string;
  pdf?: { filename: string; pageNumber: number };
  photos: { id: string; description: string }[];
};

export type ProcedureTopic = { procedureId: string; header: ProcedureHeader; parts: TitleParts | null };

/** Model output for one post; validated into `TriageSuggestions` by code. */
export type RawSuggestion = {
  candidates: { procedureId: string; reason?: string }[];
  proposal: { target?: unknown; workType?: unknown; detail?: unknown; identifiers?: unknown; reviewTier?: unknown; reason?: unknown } | null;
  confidence: number;
};

export type RawStep = {
  title: string; body: string; cautions: string[]; needsReview: string[];
  photoIds: string[]; sources: { materialId: string; quote?: string }[];
};

export type SuggestionInput = {
  materials: MaterialDigest[];
  /** Part number read from a routing-slip barcode, if any. */
  scannedPartNumber: string | null;
  topics: ProcedureTopic[];
  workTypes: string[];
};

export interface ProcedureInferencePort {
  suggest(input: SuggestionInput, signal: AbortSignal): Promise<RawSuggestion>;
  compose(header: ProcedureHeader, materials: MaterialDigest[], signal: AbortSignal): Promise<RawStep[]>;
}

/** Words that mark shop-floor work whose mistakes reach product quality. */
const QUALITY_CRITICAL = /切削|段取|検査|測定|組立|組付|加工|研削|旋盤|フライス|トルク|締付|治具|寸法|公差/;
const CONFIDENT = 0.8;

export function digestMaterial(material: ProcedureMaterial): MaterialDigest {
  const { source, organized } = material;
  return {
    id: material.id, title: organized.title, summary: organized.summary.slice(0, 600), text: source.text.slice(0, 1800),
    capturedAt: source.capturedAt,
    ...(source.pdf ? { pdf: { filename: source.pdf.filename, pageNumber: source.pdf.pageNumber } } : {}),
    photos: organized.photos.map(photo => ({ id: photo.id, description: photo.description })),
  };
}

/**
 * Quality-critical or uncertain topics always need an approval; only a confident,
 * clearly general topic may publish without one.
 */
export function enforceReviewTier(header: ProcedureHeader, confidence: number): KnowledgeProcedureReviewTier {
  if (header.reviewTier === 'approval_required' || confidence < CONFIDENT) return 'approval_required';
  const text = [header.title, header.category, header.identifiers.processName ?? ''].join(' ');
  if (QUALITY_CRITICAL.test(text) || header.identifiers.partNumber || header.identifiers.drawingNumber) return 'approval_required';
  return 'auto_publish';
}

const IDENTIFIER_KEYS = ['partNumber', 'drawingNumber', 'processName'] as const;
const MAX_CANDIDATES = 3;

const trimmed = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/**
 * Models omit empty objects, send empty strings or add unrequested keys. Only the known
 * identifier keys with non-empty text survive.
 */
export function normalizeIdentifiers(raw: unknown): ProcedureIdentifiers {
  const given = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return Object.fromEntries(IDENTIFIER_KEYS.flatMap(key => {
    const value = trimmed(given[key], 200);
    return value ? [[key, value]] : [];
  }));
}

/**
 * Keeps only candidates that exist, fits the proposal to the managed work types and the
 * three-part title, and decides the review tier in code.
 */
export function validateSuggestions(raw: RawSuggestion, input: SuggestionInput): TriageSuggestions {
  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw.confidence) ? raw.confidence : 0));
  const topics = new Map(input.topics.map(topic => [topic.procedureId, topic]));
  const seen = new Set<string>();
  const candidates = raw.candidates.flatMap(candidate => {
    const topic = topics.get(candidate.procedureId);
    if (!topic || seen.has(topic.procedureId)) return [];
    seen.add(topic.procedureId);
    return [{ procedureId: topic.procedureId, title: topic.header.title, reason: trimmed(candidate.reason, 200) ?? '' }];
  }).slice(0, MAX_CANDIDATES);

  let proposal: TriageSuggestions['proposal'] = null;
  const target = trimmed(raw.proposal?.target, 80);
  if (raw.proposal && target) {
    const requested = trimmed(raw.proposal.workType, 30);
    const workType = requested && input.workTypes.includes(requested) ? requested : 'その他';
    const detail = trimmed(raw.proposal.detail, 40);
    const identifiers = normalizeIdentifiers(raw.proposal.identifiers);
    if (input.scannedPartNumber && !identifiers.partNumber) identifiers.partNumber = input.scannedPartNumber;
    const parts = titlePartsSchema.parse({ target, workType, ...(detail ? { detail } : {}) });
    const title = composeTitle(parts);
    const requestedTier = raw.proposal.reviewTier === 'auto_publish' ? 'auto_publish' : 'approval_required';
    const reviewTier = enforceReviewTier({ title, category: workType, identifiers, reviewTier: requestedTier }, confidence);
    proposal = { parts, title, identifiers, reviewTier, reason: trimmed(raw.proposal.reason, 200) ?? '' };
  }
  return { candidates, proposal, confidence };
}

function sourceOf(material: ProcedureMaterial, quote: string | undefined): KnowledgeProcedureSource {
  const { source } = material;
  const date = source.capturedAt.slice(0, 10).replaceAll('-', '/');
  const base = { ref: source.id, capturedAt: source.capturedAt, ...(quote ? { quote } : {}) };
  if (source.pdf) return { ...base, kind: 'pdf_page', label: `PDF「${source.pdf.filename}」${source.pdf.pageNumber}ページ` };
  const photoOnly = !source.text.trim() || source.text === '（写真のみ）';
  return photoOnly ? { ...base, kind: 'photo', label: `写真 ${date}` } : { ...base, kind: 'note', label: `メモ ${date}` };
}

/**
 * Keeps only what the materials support: unknown sources, photos of uncited materials and
 * quotations that are not verbatim substrings are dropped; a step left without a source is dropped.
 */
export function buildProcedureContent(materials: ProcedureMaterial[], steps: RawStep[]): ProcedureContent {
  const byId = new Map(materials.map(material => [material.id, material]));
  const built: KnowledgeProcedureStep[] = [];
  for (const step of steps) {
    const cited = step.sources.flatMap(reference => {
      const material = byId.get(reference.materialId);
      if (!material) return [];
      const quote = reference.quote?.trim();
      return [{ material, quote: quote && material.source.text.includes(quote) ? quote : undefined }];
    });
    const unique = [...new Map(cited.map(entry => [entry.material.id, entry])).values()];
    if (!unique.length) continue;
    const captions = new Map(unique.flatMap(({ material }) => material.organized.photos.map(photo => [photo.id, photo.description] as const)));
    const photos = [...new Set(step.photoIds)].filter(id => captions.has(id)).slice(0, 8).map(id => ({ imageId: id, caption: (captions.get(id) ?? '').slice(0, 500) }));
    built.push({
      id: `s${built.length + 1}`, title: step.title, body: step.body, cautions: step.cautions.slice(0, 10), needsReview: step.needsReview.slice(0, 10),
      photos, sources: unique.slice(0, 20).map(({ material, quote }) => sourceOf(material, quote)),
    });
  }
  if (!built.length) throw new Error('NO_SUPPORTED_STEPS');
  return procedureContentSchema.parse({ formatVersion: 1, steps: built.slice(0, 100) });
}
