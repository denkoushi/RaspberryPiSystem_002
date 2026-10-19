import { describe, expect, it } from 'vitest';

import { autoEditApplyInput, mergeScene, moveSceneBoundary, splitScene } from './procedure-video-timeline';

const scenes = [
  { title: '準備', startSeconds: 0, endSeconds: 5, caption: '位置を合わせる', needsReview: true },
  { title: '確認', startSeconds: 5, endSeconds: 12, caption: '確認する' }
];
describe('procedure video timeline', () => {
  it('moves both adjacent edges in tenths without mutating the input', () => {
    const result = moveSceneBoundary(scenes, 1, 4.36);
    expect(result.map((scene) => [scene.startSeconds, scene.endSeconds])).toEqual([[0, 4.4], [4.4, 12]]);
    expect(scenes[0].endSeconds).toBe(5);
  });
  it.each([[-20, 0.5], [20, 11.5]])('clamps boundary %s with at least half a second on either side', (at, expected) => {
    const result = moveSceneBoundary(scenes, 1, at);
    expect(result[0].endSeconds).toBe(expected); expect(result[1].startSeconds).toBe(expected);
  });
  it('rejects outer or impossible boundaries', () => {
    expect(moveSceneBoundary(scenes, 0, 2)).toBe(scenes);
    expect(moveSceneBoundary(scenes, 2, 2)).toBe(scenes);
    const tiny = [{ ...scenes[0], endSeconds: 0.2 }, { ...scenes[1], startSeconds: 0.2, endSeconds: 0.6 }];
    expect(moveSceneBoundary(tiny, 1, 0.3)).toBe(tiny);
  });
  it('splits into an original and a blank scene at rounded time', () => {
    expect(splitScene(scenes, 2.36)).toEqual([{ ...scenes[0], endSeconds: 2.4 }, { title: '', caption: '', startSeconds: 2.4, endSeconds: 5 }, scenes[1]]);
  });
  it('allows exactly half a second and rejects smaller scenes or a sixth scene', () => {
    expect(splitScene(scenes, 0.5)).toHaveLength(3);
    expect(splitScene(scenes, 0.4)).toBe(scenes);
    expect(splitScene(scenes, 4.6)).toBe(scenes);
    const five = Array.from({ length: 5 }, (_, i) => ({ ...scenes[0], startSeconds: i * 5, endSeconds: (i + 1) * 5 }));
    expect(splitScene(five, 2)).toBe(five);
  });
  it('merges first or last into its neighbour and preserves its text', () => {
    expect(mergeScene(scenes, 0)).toEqual([{ ...scenes[1], startSeconds: 0 }]);
    expect(mergeScene(scenes, 1)).toEqual([{ ...scenes[0], endSeconds: 12 }]);
    expect(mergeScene([scenes[0]], 0)).toEqual([scenes[0]]);
    expect(scenes).toHaveLength(2);
  });
  it('uses ordered fallback names and only nonempty captions in the request', () => {
    expect(autoEditApplyInput('suggestion', [{ ...scenes[0], title: '  ', caption: '  ' }, { ...scenes[1], title: '', caption: ' 確認 ' }])).toEqual({
      suggestionId: 'suggestion', comments: [{ atSeconds: 5, text: '確認' }],
      scenes: [{ title: '場面 1', startSeconds: 0, endSeconds: 5 }, { title: '場面 2', startSeconds: 5, endSeconds: 12 }]
    });
  });
});
