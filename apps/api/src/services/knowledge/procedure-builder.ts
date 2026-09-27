import type { KnowledgeProcedureReviewTier, KnowledgeProcedureSource, KnowledgeProcedureStep } from '@raspi-system/shared-types';

import type { ProcedureMaterial } from './procedure-material.port.js';
import { procedureContentSchema, procedureHeaderSchema, type ProcedureContent, type ProcedureHeader } from './procedure-content.js';

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

export type ProcedureTopic = { procedureId: string; header: ProcedureHeader };

export type RawAssignment = {
  action: 'existing' | 'new' | 'none';
  procedureId?: string;
  header?: unknown;
  confidence: number;
};

export type RawStep = {
  title: string; body: string; cautions: string[]; needsReview: string[];
  photoIds: string[]; sources: { materialId: string; quote?: string }[];
};

export interface ProcedureInferencePort {
  assign(material: MaterialDigest, topics: ProcedureTopic[], signal: AbortSignal): Promise<RawAssignment>;
  compose(header: ProcedureHeader, materials: MaterialDigest[], signal: AbortSignal): Promise<RawStep[]>;
}

export type Assignment = { kind: 'existing'; topic: ProcedureTopic } | { kind: 'new'; header: ProcedureHeader } | { kind: 'none' };

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

export function validateAssignment(raw: RawAssignment, topics: ProcedureTopic[]): Assignment {
  if (raw.action === 'none') return { kind: 'none' };
  if (raw.action === 'existing') {
    const topic = topics.find(candidate => candidate.procedureId === raw.procedureId);
    if (!topic) throw new Error('UNKNOWN_PROCEDURE_TOPIC');
    return { kind: 'existing', topic };
  }
  const header = procedureHeaderSchema.parse(normalizeHeader(raw.header));
  return { kind: 'new', header: { ...header, reviewTier: enforceReviewTier(header, raw.confidence) } };
}

const IDENTIFIER_KEYS = ['partNumber', 'drawingNumber', 'processName'] as const;

/**
 * Models omit empty objects, send empty strings or add unrequested keys. Only the known
 * identifier keys with non-empty text survive; a missing tier falls back to the safe side.
 */
export function normalizeHeader(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const header = raw as Record<string, unknown>;
  const given = header.identifiers && typeof header.identifiers === 'object' ? header.identifiers as Record<string, unknown> : {};
  const identifiers = Object.fromEntries(IDENTIFIER_KEYS.flatMap(key => {
    const value = given[key];
    return typeof value === 'string' && value.trim() ? [[key, value.trim()]] : [];
  }));
  return { title: header.title, category: header.category, identifiers, reviewTier: header.reviewTier ?? 'approval_required' };
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
