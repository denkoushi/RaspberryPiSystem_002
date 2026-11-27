import { describe, expect, it } from 'vitest';
import { resultSchema } from './queue-storage.js';
import { securityReviewChunkAnswerSchema } from './report-schema.js';
import { knownForChunk, reviewMessages } from './review-completion.js';

describe('review answer contract', () => {
  it.each(['changes', 'security', 'errors'] as const)('explains complete clean reviews and genuine refusals for %s', kind => {
    const prompt = reviewMessages({ id: 'unit', kind, text: '+cosmetic\n' }, [])[0]!.content;
    expect(prompt).toContain('no medium/high issue is found, return findings [] and refusedOrVague false');
    expect(prompt).toContain('complete review even for small, cosmetic or partial changes');
    expect(prompt).toContain('only when declining, or when code the change depends on is missing and a security judgement is impossible');
    expect(prompt).toContain('Only when refusedOrVague is true, add vagueReason with one sentence');
    expect(prompt).toContain('Files listed in filesReviewedSeparately belong to the same change and are reviewed, wholly or in part, in other units');
    const example = JSON.parse(prompt.match(/Return only JSON: (.*)\. Only findings,/)![1]!);
    expect(securityReviewChunkAnswerSchema.parse({ ...example, findings: [] })).toEqual({ findings: [], refusedOrVague: false });
  });

  it('accepts optional reasons, bounds them to 200 characters and stays strict', () => {
    const legacy = { findings: [], refusedOrVague: true };
    expect(securityReviewChunkAnswerSchema.parse(legacy)).toEqual(legacy);
    expect(securityReviewChunkAnswerSchema.parse({ ...legacy, vagueReason: 'x'.repeat(201) }).vagueReason).toBe('x'.repeat(200));
    expect(() => securityReviewChunkAnswerSchema.parse({ ...legacy, vagueReason: 1 })).toThrow();
    expect(() => securityReviewChunkAnswerSchema.parse({ ...legacy, extra: true })).toThrow();
  });

  it('accepts legacy failed records and bounds optional details and paths', () => {
    const legacy = { version: 1, sha: 'a'.repeat(40), committedAt: '2026-11-02T00:00:00Z', finishedAt: '2026-11-02T00:00:00Z',
      status: 'failed', units: 1, findings: [], reportedAt: null, failedUnits: [{ path: 'app.ts', reason: 'refused_or_vague' }] };
    expect(resultSchema.parse(legacy)).toEqual(legacy);
    expect(resultSchema.parse({ ...legacy, failedUnits: [{ ...legacy.failedUnits[0], detail: 'x'.repeat(201), paths: ['p'.repeat(501)] }] }).failedUnits[0])
      .toMatchObject({ detail: 'x'.repeat(200), paths: ['p'.repeat(500)] });
  });
});

describe('known findings sent with a chunk', () => {
  const entry = (location: string, date: string, kind: 'changes' | 'security' | 'errors' = 'changes') =>
    ({ fingerprint: 'a'.repeat(64), kind, location, what: 'w'.repeat(150), reason: 'r'.repeat(150), date });
  it('sends findings for files in the chunk first, then newest of the same kind, within 8KB', () => {
    const old = Array.from({ length: 40 }, (_, i) => entry(`apps/old${i}.ts:1`, '2026-10-01'));
    const known = { state: 'loaded' as const, fingerprints: new Set<string>(), entries: [
      ...old, entry('apps/api/src/target.ts:12', '2026-10-02'), entry('apps/new.ts:3', '2026-11-20'), entry('caddy: x', '2026-11-21', 'security')] };
    const prompt = knownForChunk(known, { id: 'u', kind: 'changes', text: 'diff --git a/apps/api/src/target.ts b/apps/api/src/target.ts\n' });
    expect(prompt[0]).toMatchObject({ location: 'apps/api/src/target.ts:12', reason: 'r'.repeat(150) });
    expect(prompt[1]!.location).toBe('apps/new.ts:3');
    expect(Buffer.byteLength(JSON.stringify(prompt))).toBeLessThanOrEqual(8000 + prompt.length + 2);
    expect(prompt.some(item => item.location === 'caddy: x')).toBe(false);
  });
});
