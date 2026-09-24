// Query-embedding port. Production uses `none`. `local-onnx` is evaluation only.
// A remote DGX text-embedding adapter belongs here once its contract exists.

export const DEFAULT_EMBED_BUDGET_MS = 800;

export function createNoneQueryEmbedding() {
  return {
    id: 'none',
    async embedQuery() {
      return { ok: false, status: 'not_requested', reason: 'query embedding is not configured' };
    },
  };
}

export async function createLocalOnnxQueryEmbedding(options = {}) {
  const { createOnnxEmbedder } = await import('./embed-runtime.mjs');
  const embedder = await createOnnxEmbedder(options);
  return {
    id: 'local-onnx',
    modelId: embedder.modelId,
    async embedQuery(text) {
      const vectors = await embedder.embed([text], { prefix: 'query: ' });
      return { ok: true, status: 'ok', vector: vectors[0], modelId: embedder.modelId };
    },
    async embedPassages(texts) {
      return embedder.embed(texts, { prefix: 'passage: ' });
    },
  };
}

export function withEmbeddingBudget(work, budgetMs = DEFAULT_EMBED_BUDGET_MS) {
  const budget = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : DEFAULT_EMBED_BUDGET_MS;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('query embedding timed out');
      error.code = 'timeout';
      reject(error);
    }, budget);
  });
  return Promise.race([Promise.resolve().then(work), timeout]).finally(() => clearTimeout(timer));
}
