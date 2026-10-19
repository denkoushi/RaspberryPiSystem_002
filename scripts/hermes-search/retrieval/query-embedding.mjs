// Query-embedding port. Production uses `none`. `local-onnx` is evaluation only.
// A remote DGX text-embedding adapter belongs here once its contract exists.

// The DGX embeds a question in about 20 to 60 ms, but the path from the Pi 5 (egress proxy and the
// DGX business gateway) adds about 300 ms and sometimes jumps to 1.8 to 3.8 s (2026-09-29). The
// answer target is 5 s, so the budget allows a short jump before falling back to word matching.
export const DEFAULT_EMBED_BUDGET_MS = 1500;

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
