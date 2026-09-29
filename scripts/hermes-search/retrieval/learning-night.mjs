// Wires the dry-run learning pass into the overnight enrichment runner: the same corpus, the stored
// enrichment, the Pi 5 dense vectors, and the JEV relevance judge that Chat uses.
import { loadNonconformityCatalog } from './catalog.mjs';
import { recordFromAuthorizedRow } from './corpus.mjs';
import { attachEnrichment } from './enrichment-attach.mjs';
import { enrichmentSettings, withinWindow } from './enrichment-dgx.mjs';
import { readEnrichmentStore, storePathFromEnv } from './enrichment-store.mjs';
import { createDenseQueryRanker, createDgxEmbedder, denseSettings, readDenseStore } from './dense-dgx.mjs';
import { createRelevanceJudge } from './relevance-jev.mjs';
import { proposeFromMisses } from './learning-proposals.mjs';

// Night-time question embedding may wait behind bulk document embedding, so it gets a longer limit.
const NIGHT_QUERY_TIMEOUT_MS = 10_000;

export async function runLearningPass({ rows, env = process.env, now = () => new Date(), propose = proposeFromMisses } = {}) {
  const settings = enrichmentSettings(env);
  if (!settings.enabled || env.HERMES_RETRIEVAL_LEARNING === 'off') return { reason: 'disabled' };
  if (!withinWindow(settings.window, now())) return { reason: 'outside_window' };
  const catalog = loadNonconformityCatalog();
  const base = (rows ?? []).map((row) => (row?.kind === 'nonconformity' ? recordFromAuthorizedRow(row) : row))
    .filter((row) => row && typeof row.id === 'string' && row.id);
  if (!base.length) return { reason: 'empty' };
  const records = attachEnrichment(base, await readEnrichmentStore(storePathFromEnv(env)));
  const dense = denseSettings(env);
  let vector = null;
  if (dense.queryEnabled && dense.origin) {
    const entries = await readDenseStore(dense.storePath);
    if (entries.length) {
      const embedder = createDgxEmbedder({ baseUrl: dense.origin, token: dense.token, egress: dense.egress, timeoutMs: NIGHT_QUERY_TIMEOUT_MS });
      vector = createDenseQueryRanker(() => entries, (texts, extra) => embedder.embed(texts, extra));
    }
  }
  const judge = createRelevanceJudge();
  return propose({ records, catalog, vector, judge: (input) => judge.judge(input), now });
}
