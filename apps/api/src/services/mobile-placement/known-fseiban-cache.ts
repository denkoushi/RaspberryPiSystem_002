import { listKnownScheduleFseibans } from '../production-schedule/production-schedule-lookup.service.js';

export const KNOWN_FSEIBAN_CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { values: string[]; expiresAt: number } | undefined;

export function resetKnownFseibanCache(): void {
  cached = undefined;
}

export async function getKnownFseibans(): Promise<string[]> {
  if (cached && Date.now() < cached.expiresAt) return cached.values;
  const values = await listKnownScheduleFseibans();
  cached = { values, expiresAt: Date.now() + KNOWN_FSEIBAN_CACHE_TTL_MS };
  return values;
}
