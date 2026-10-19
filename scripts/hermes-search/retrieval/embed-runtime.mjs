// Optional ONNX embedder and cross-encoder. Models stay in the private cache.
// ruri-v3 has no ONNX export, so the Node runtime uses the e5 / bge ONNX fallbacks.
import path from 'node:path';

export const DEFAULT_EMBED_MODEL = 'Xenova/multilingual-e5-base';
export const DEFAULT_RERANK_MODEL = 'Xenova/bge-reranker-base';
export const DEFAULT_DTYPE = 'int8';
export const RERANK_ACCEPT_AT = 0.3;

function cacheDir() {
  return process.env.HERMES_MODEL_CACHE
    || path.join(process.env.HOME, 'Documents', 'hermes-retrieval-private', 'models');
}

async function transformers() {
  const runtime = await import('@huggingface/transformers');
  runtime.env.cacheDir = cacheDir();
  runtime.env.allowLocalModels = true;
  return runtime;
}

function rowsFromTensor(tensor, count) {
  const data = tensor?.data ?? tensor?.tolist?.()?.flat?.() ?? [];
  const dims = tensor?.dims ?? [];
  const width = dims.length >= 2 ? dims[dims.length - 1] : Math.floor(data.length / Math.max(1, count));
  const vectors = [];
  for (let index = 0; index < count; index += 1) {
    vectors.push(Array.from(data.slice(index * width, (index + 1) * width)));
  }
  return vectors;
}

export async function createOnnxEmbedder({ modelId = DEFAULT_EMBED_MODEL, dtype = DEFAULT_DTYPE } = {}) {
  const { pipeline } = await transformers();
  const extractor = await pipeline('feature-extraction', modelId, { dtype });
  return {
    modelId,
    dtype,
    async embed(texts, { prefix = '' } = {}) {
      const input = texts.map((text) => `${prefix}${text}`);
      const vectors = [];
      const batchSize = 16;
      for (let start = 0; start < input.length; start += batchSize) {
        const batch = input.slice(start, start + batchSize);
        const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
        vectors.push(...rowsFromTensor(tensor, batch.length));
      }
      return vectors;
    },
  };
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

export async function createOnnxReranker({ modelId = DEFAULT_RERANK_MODEL, dtype = DEFAULT_DTYPE } = {}) {
  const { AutoTokenizer, AutoModelForSequenceClassification } = await transformers();
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await AutoModelForSequenceClassification.from_pretrained(modelId, { dtype });
  return {
    modelId,
    dtype,
    async scorePairs(pairs) {
      const scores = [];
      for (const [query, passage] of pairs) {
        const inputs = await tokenizer([String(query ?? '')], {
          text_pair: [String(passage ?? '')],
          padding: true,
          truncation: true,
        });
        const output = await model(inputs);
        const logit = Number(output?.logits?.data?.[0] ?? 0);
        scores.push(sigmoid(logit));
      }
      return scores;
    },
  };
}
