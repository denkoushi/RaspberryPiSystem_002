import { createHash } from 'node:crypto';
import type { SecurityReviewFinding } from './report-schema.js';

export const MATERIAL_BYTES = 8000;
export const MAX_CHUNKS = 24;
export type ReviewKind = SecurityReviewFinding['kind'];
export type ReviewChunk = { id: string; kind: ReviewKind; text: string };

export function fingerprint(finding: Pick<SecurityReviewFinding, 'kind' | 'location' | 'what'>): string {
  const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
  return createHash('sha256').update([finding.kind, finding.location, finding.what].map(normalize).join('|')).digest('hex');
}

export function redactCode(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
}

export function redact(text: string): string {
  return redactCode(text)
    .replace(/(^|[\s"'<>(=])((?:https?:\/\/|\/)[^\s"'<>?]*)\?[^\s"'<>]*/gim, '$1$2?[REDACTED]')
    .replace(/((?:authorization|proxy-authorization|cookie|set-cookie|[\w-]*(?:token|password|passwd|secret|api[_-]?key|client[_-]?key)[\w-]*)["']?\s*[:=]\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? value : '[REDACTED]');
}

export function splitBytes(text: string, cap = MATERIAL_BYTES): string[] {
  const chunks: string[] = [];
  let part = ''; let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > cap) { chunks.push(part); part = ''; bytes = 0; }
    part += character; bytes += size;
  }
  if (part) chunks.push(part);
  return chunks;
}

export function prepareChunks(material: Record<ReviewKind, string>) {
  const chunks: ReviewChunk[] = [];
  const truncated = { security: 0, errors: 0, changes: 0 };
  const kinds = ['security', 'errors', 'changes'] as const;
  const pending: Record<ReviewKind, ReviewChunk[]> = { security: [], errors: [], changes: [] };
  const allocated = { security: 0, errors: 0, changes: 0 };
  for (const kind of kinds) {
    const sections = kind === 'changes' ? material[kind].split(/(?=^diff --git )/m) : [material[kind]];
    let index = 0;
    for (const section of sections) for (const text of splitBytes(section)) {
      index++;
      pending[kind].push({ id: `${kind}-${index}`, kind, text });
    }
  }
  let remaining = MAX_CHUNKS;
  while (remaining && kinds.some(kind => allocated[kind] < pending[kind].length)) {
    for (const kind of kinds) {
      if (remaining && allocated[kind] < pending[kind].length) {
        allocated[kind]++;
        remaining--;
      }
    }
  }
  for (const kind of kinds) {
    chunks.push(...pending[kind].slice(0, allocated[kind]));
    truncated[kind] = pending[kind].length - allocated[kind];
  }
  return { chunks, truncated };
}

export function quoteData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
