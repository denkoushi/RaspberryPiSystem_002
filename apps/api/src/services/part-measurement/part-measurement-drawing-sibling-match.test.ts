import { describe, expect, it } from 'vitest';

import { parseSiblingVisionResponse, prefilterDrawingSiblings } from './part-measurement-drawing-sibling-match.js';
import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';

const dimension = (nominal: number, kind: PartMeasurementDrawingDimension['kind'] = 'len') => ({
  nominal, kind, text: String(nominal), upperTolerance: null, lowerTolerance: null, depth: null,
  xRatio: 0.5, yRatio: 0.5, tileId: 'tile'
});
const visual = (id: string, name: string, dimensions: PartMeasurementDrawingDimension[]) => ({
  id, name, map: { image: { width: 1000, height: 1000 }, dimensions }
});

describe('prefilterDrawingSiblings', () => {
  it('counts distinct kind/value pairs within tolerance, ignores other and adds a nonempty family bonus', () => {
    const target = visual('target', 'スタンド', [dimension(10), dimension(10 + 0.0000001), dimension(20, 'hole'), dimension(99, 'other')]);
    const result = prefilterDrawingSiblings(target, [
      visual('content', '足', [dimension(10 + 0.0000005), dimension(10), dimension(20, 'hole')]),
      visual('name', 'スタンド(左)', []),
      visual('wrong-kind', '無関係', [dimension(10, 'hole'), dimension(99, 'other')]),
      visual('outside', '無関係', [dimension(10.000002)]), target
    ]);
    expect(result.map(({ id, score }) => ({ id, score }))).toEqual([{ id: 'name', score: 3 }, { id: 'content', score: 2 }]);
    expect(prefilterDrawingSiblings(visual('target', '', []), [visual('empty', '', [])])).toEqual([]);
  });

  it('keeps at most eight positive candidates in deterministic score order', () => {
    const target = visual('target', 'スタンド', [dimension(10)]);
    const candidates = Array.from({ length: 10 }, (_, i) => visual(`id-${i}`, '足', [dimension(10)]));
    expect(prefilterDrawingSiblings(target, candidates.reverse()).map(({ id }) => id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `id-${i}`)
    );
  });
});

describe('parseSiblingVisionResponse', () => {
  const candidate = { label: 'candidate_1', sameFamily: true, confidence: 0.8 };
  it('accepts plain and fenced JSON', () => {
    const json = JSON.stringify({ candidates: [candidate] });
    expect(parseSiblingVisionResponse(json, ['candidate_1'])).toEqual([candidate]);
    expect(parseSiblingVisionResponse(`\`\`\`json\n${json}\n\`\`\``, ['candidate_1'])).toEqual([candidate]);
  });
  it.each([
    'not json', '{}', '{"candidates":[]}',
    JSON.stringify({ candidates: [{ ...candidate, confidence: 1.1 }] }),
    JSON.stringify({ candidates: [{ ...candidate, sameFamily: 'true' }] }),
    JSON.stringify({ candidates: [{ ...candidate, label: 'unknown' }] }),
    JSON.stringify({ candidates: [candidate, candidate] })
  ])('rejects malformed, missing, duplicated or unknown candidates: %s', (raw) => {
    expect(() => parseSiblingVisionResponse(raw, ['candidate_1'])).toThrow();
  });
});
