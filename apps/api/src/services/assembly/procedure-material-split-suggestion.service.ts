import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';

const MODEL = 'jev-1.13.0';
const TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 2000;
const QUESTION = {
  type: 'choice',
  instructions:
    '`prev_page` と `next_page` は、紙の書類を 1 枚ずつ撮影・スキャンした連続する 2 ページの画像である。' +
    '`next_page` が `prev_page` と同じ書類(同じ要領書・図面・帳票)の続きのページか、別の書類の最初のページかを一つ選ぶ。' +
    '文書番号・表題・品番・図番・様式・ページ番号(例 1/2)の一致や違いを手がかりにする。様式が同じでも文書番号や表題が違えば別の書類とする。',
  criteria: {
    continuation: '`next_page` は `prev_page` と同じ書類の続きのページ',
    new_document: '`next_page` は `prev_page` とは別の書類の最初のページ',
  },
};

export type ProcedureMaterialSplitSuggestions = {
  status: 'ok' | 'disabled' | 'unavailable';
  boundaries: Array<{ beforeId: string; afterId: string; probability: number }>;
};
type Deps = {
  db: Pick<PrismaClient, 'procedureMaterial'>;
  store: Pick<DurableFileStorePort, 'read'>;
  enabled: () => boolean;
  apiKey: () => string | undefined;
  timeoutMs: number;
  fetch?: typeof fetch;
  now?: () => number;
};

// Race even providers/storage that do not honor cancellation, including response.json().
async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Split suggestion timed out'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export class ProcedureMaterialSplitSuggestionService {
  private readonly cache = new Map<string, { probability: number; expiresAt: number }>();
  constructor(private readonly deps: Deps) {}
  private now() { return this.deps.now?.() ?? Date.now(); }

  private async image(storageKey: string) {
    const original = await this.deps.store.read(storageKey, { verifyIntegrity: true });
    const { data, info } = await sharp(original).rotate()
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;
    if (Math.min(info.width, info.height) < 256 || pixels < 78_400 || pixels > 2_458_624 || data.length > 16 * 1024 * 1024) return null;
    return { sha256: createHash('sha256').update(original).digest('hex'),
      asset: { type: 'image', format: 'jpeg', data_base64: data.toString('base64') } };
  }

  async suggest(ids: string[]): Promise<ProcedureMaterialSplitSuggestions> {
    const apiKey = this.deps.apiKey();
    if (!this.deps.enabled() || !apiKey || apiKey.length < 16) return { status: 'disabled', boundaries: [] };
    if (ids.length < 2 || ids.length > 60) return { status: 'unavailable', boundaries: [] };
    const started = this.now();
    const overall = new AbortController();
    const timer = setTimeout(() => overall.abort(), this.deps.timeoutMs);
    const boundaries = new Map<number, ProcedureMaterialSplitSuggestions['boundaries'][number]>();
    let succeeded = 0;
    let failed = 0;
    let attempted = 0;
    const run = async () => {
      const rows = await bounded(this.deps.db.procedureMaterial.findMany({ where: { id: { in: ids } },
        select: { id: true, kind: true, origin: true, discardedAt: true, gmailMessageId: true, storageKey: true } }), overall.signal);
      const byId = new Map(rows.map(row => [row.id, row]));
      const ordered = ids.map(id => byId.get(id));
      const images = new Map<string, ReturnType<ProcedureMaterialSplitSuggestionService['image']>>();
      const image = (key: string) => {
        let pending = images.get(key);
        if (!pending) { pending = this.image(key); images.set(key, pending); }
        return pending;
      };
      let next = 1;
      const worker = async () => {
        while (next < ordered.length && !overall.signal.aborted) {
          const index = next++;
          const prev = ordered[index - 1];
          const current = ordered[index];
          if (!prev || !current || [prev, current].some(row => row.kind !== 'PHOTO' || row.origin !== 'GMAIL' || row.discardedAt || !row.storageKey)
            || !prev.gmailMessageId || prev.gmailMessageId !== current.gmailMessageId) continue;
          attempted++;
          const controller = new AbortController();
          const abort = () => controller.abort();
          overall.signal.addEventListener('abort', abort, { once: true });
          const pairTimer = setTimeout(abort, this.deps.timeoutMs);
          try {
            const [a, b] = await bounded(Promise.all([image(prev.storageKey!), image(current.storageKey!)]), controller.signal);
            if (!a || !b || overall.signal.aborted) continue;
            const key = `${a.sha256}:${b.sha256}:${MODEL}`;
            const cached = this.cache.get(key);
            this.cache.delete(key);
            let probability: number;
            if (cached && cached.expiresAt > this.now()) {
              probability = cached.probability;
              this.cache.set(key, cached);
            } else {
              const response = await bounded((this.deps.fetch ?? globalThis.fetch)('https://api.typesafe.ai/v1/systemone', {
                method: 'POST', signal: controller.signal,
                headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' },
                body: JSON.stringify({ model: MODEL, state: { prev_page: 'page-a', next_page: 'page-b' },
                  questions: { boundary: QUESTION }, assets: { 'page-a': a.asset, 'page-b': b.asset } }),
              }), controller.signal);
              if (!response.ok) throw new Error('Split suggestion upstream failed');
              const result = await bounded(response.json(), controller.signal);
              probability = result?.answers?.boundary?.probabilities?.new_document;
              if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid probability');
              if (overall.signal.aborted) continue;
              this.cache.set(key, { probability, expiresAt: this.now() + TTL_MS });
              if (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
            }
            succeeded++;
            if (probability >= 0.5) boundaries.set(index, { beforeId: current.id, afterId: prev.id, probability });
          } catch { failed++; }
          finally { clearTimeout(pairTimer); overall.signal.removeEventListener('abort', abort); }
        }
      };
      await Promise.all(Array.from({ length: 3 }, worker));
    };
    try { await bounded(run(), overall.signal); }
    catch { /* Database, image and upstream failures all leave today's bundle intact. */ }
    finally { clearTimeout(timer); overall.abort(); }
    logger.info({ attempted, succeeded, failed, durationMs: this.now() - started }, 'Procedure material split suggestions');
    return { status: succeeded ? 'ok' : 'unavailable', boundaries: [...boundaries].sort(([a], [b]) => a - b).map(([, boundary]) => boundary) };
  }
}

let instance: ProcedureMaterialSplitSuggestionService | undefined;
export function getProcedureMaterialSplitSuggestionService() {
  return instance ??= new ProcedureMaterialSplitSuggestionService({ db: prisma, store: getFileStorageRuntime().store,
    enabled: () => env.PROCEDURE_MATERIAL_SPLIT_SUGGESTION_ENABLED, apiKey: () => env.TYPESAFE_API_KEY,
    timeoutMs: env.PROCEDURE_MATERIAL_SPLIT_SUGGESTION_TIMEOUT_MS });
}
