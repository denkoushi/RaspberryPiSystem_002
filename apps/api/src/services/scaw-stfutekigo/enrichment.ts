import type { ScawStfutekigoEnrichment } from './types.js';

export interface ScawStfutekigoEnrichmentAdapter {
  enrich(orderNumbers: readonly string[]): Promise<ReadonlyMap<string, ScawStfutekigoEnrichment>>;
}
