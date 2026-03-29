import fetch from 'node-fetch';

import { env } from '../../../config/env.js';

import type { PhotoToolImageEmbeddingPort } from './photo-tool-image-embedding.port.js';

type EmbeddingResponseJson = {
  embedding?: number[];
  modelId?: string;
};

/**
 * POST { jpegBase64, modelId? } → { embedding: number[], modelId? }
 * Content-Type: application/json
 */
export class HttpPhotoToolImageEmbeddingAdapter implements PhotoToolImageEmbeddingPort {
  constructor(private readonly opts: { url: string; apiKey?: string; timeoutMs: number; expectedDim: number }) {}

  async embedJpeg(jpegBytes: Buffer): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.opts.apiKey) {
        headers.Authorization = `Bearer ${this.opts.apiKey}`;
      }
      const res = await fetch(this.opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jpegBase64: jpegBytes.toString('base64'),
          modelId: env.PHOTO_TOOL_EMBEDDING_MODEL_ID,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Embedding HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as EmbeddingResponseJson;
      const emb = json.embedding;
      if (!Array.isArray(emb) || emb.length !== this.opts.expectedDim) {
        throw new Error(`Invalid embedding length: expected ${this.opts.expectedDim}, got ${emb?.length}`);
      }
      if (!emb.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        throw new Error('Embedding contains non-finite numbers');
      }
      return emb;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createHttpPhotoToolImageEmbeddingAdapter(): PhotoToolImageEmbeddingPort | null {
  if (!env.PHOTO_TOOL_EMBEDDING_ENABLED || !env.PHOTO_TOOL_EMBEDDING_URL) {
    return null;
  }
  return new HttpPhotoToolImageEmbeddingAdapter({
    url: env.PHOTO_TOOL_EMBEDDING_URL,
    apiKey: env.PHOTO_TOOL_EMBEDDING_API_KEY,
    timeoutMs: env.PHOTO_TOOL_EMBEDDING_TIMEOUT_MS,
    expectedDim: env.PHOTO_TOOL_EMBEDDING_DIMENSION,
  });
}
