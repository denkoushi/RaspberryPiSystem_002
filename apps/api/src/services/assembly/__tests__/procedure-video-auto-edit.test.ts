import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import { procedureVideoEnvShape } from '../../../config/env/procedure-video.js';
import { aggregateAutoEditStats, matchAutoEditScenes, autoEditPrompt, parseAutoEditSuggestion } from '../procedure-video-auto-edit.js';
import { autoEditVerificationTimes } from '../procedure-video-auto-edit-jev.service.js';

const scene = { startSeconds: 0, endSeconds: 10, title: '場面', caption: '棒が下がる' };
describe('procedure-video auto edit validation and statistics', () => {
  it('defaults both flags to false and enables only explicit true', () => {
    const schema = z.object(procedureVideoEnvShape);
    expect(schema.parse({})).toEqual({ PROCEDURE_VIDEO_AUTO_EDIT_ENABLED: false, PROCEDURE_VIDEO_AUTO_EDIT_JEV_ENABLED: false });
    expect(schema.parse({ PROCEDURE_VIDEO_AUTO_EDIT_ENABLED: 'true' }).PROCEDURE_VIDEO_AUTO_EDIT_ENABLED).toBe(true);
    expect(schema.parse({ PROCEDURE_VIDEO_AUTO_EDIT_ENABLED: 'false' }).PROCEDURE_VIDEO_AUTO_EDIT_ENABLED).toBe(false);
  });
  it.each(['invalid', '{}', '{"scenes":[{}]}', JSON.stringify({ scenes: [{ ...scene, startSeconds: '0' }] }), JSON.stringify({ scenes: [{ ...scene, caption: ' ' }] })])('rejects invalid JSON/schema %s', (raw) => {
    expect(() => parseAutoEditSuggestion(raw, 10)).toThrow();
  });
  it('clamps timestamps and truncates titles, captions and counts to existing limits', () => {
    const raw = JSON.stringify({ scenes: Array.from({ length: 8 }, (_, i) => ({ ...scene, startSeconds: i === 0 ? -3 : i * 2 + 0.04, endSeconds: i === 7 ? 99 : i * 2 + 2, title: 'あ'.repeat(25), caption: '文'.repeat(100) })) });
    const result = parseAutoEditSuggestion(raw, 15);
    expect(result.scenes).toHaveLength(5); expect(result.comments).toHaveLength(5);
    expect(result.scenes[0]).toMatchObject({ startSeconds: 0, endSeconds: 2, title: 'あ'.repeat(20), caption: '文'.repeat(40) });
    expect(parseAutoEditSuggestion(JSON.stringify({ scenes: [{ ...scene, startSeconds: 1.26, endSeconds: 99 }] }), 3).scenes[0]).toMatchObject({ startSeconds: 1.3, endSeconds: 3 });
    expect(result.comments.every((comment) => comment.text.length <= 80)).toBe(true);
  });
  it('clamps a fractional video end to an adoptable tenth within its duration', () => {
    expect(parseAutoEditSuggestion(JSON.stringify({ scenes: [{ ...scene, endSeconds: 99 }] }), 3.06).scenes[0].endSeconds).toBe(3);
  });
  it('sorts and clips overlapping scenes and drops reversed/too-short ranges', () => {
    const result = parseAutoEditSuggestion(JSON.stringify({ scenes: [{ ...scene, startSeconds: 2, endSeconds: 4 }, { ...scene, endSeconds: 3 }, { ...scene, startSeconds: 4, endSeconds: 4.1 }] }), 5);
    expect(result.scenes.map((scene) => [scene.startSeconds, scene.endSeconds])).toEqual([[0, 3], [3, 4]]);
    expect(() => parseAutoEditSuggestion(JSON.stringify({ scenes: [{ ...scene, startSeconds: 5, endSeconds: 1 }] }), 5)).toThrow('No valid scenes');
  });
  it('includes known context, observable-only instructions and Japanese timestamps contract', () => {
    const prompt = autoEditPrompt({ title: '試験', subjectHint: '組立', durationSeconds: 10 });
    for (const text of ['試験', '組立', '見えている動作だけを書く', '道具名や目的を推測しない', '動きなし', 'startSeconds']) expect(prompt).toContain(text);
  });
  it.each([[0, 0.5], [14.5, 35.9], [35.9, 36]])('selects three timestamps strictly inside %s–%s', (start, end) => {
    const times = autoEditVerificationTimes(start, end);
    expect(times).toHaveLength(3);
    expect(times.every((time) => time > start && time < end)).toBe(true);
    expect(times[1]).toBe((start + end) / 2);
  });
  it('counts unchanged, edited, deleted and added comments with one-to-one matching and scene absolute deltas', () => {
    const comments = [{ atSeconds: 0, text: 'A' }, { atSeconds: 3, text: 'B' }, { atSeconds: 6, text: 'C' }];
    const stats = aggregateAutoEditStats([
      { suggestion: { comments, scenes: [{ title: 'A', startSeconds: 0, endSeconds: 4 }, { title: 'B', startSeconds: 5, endSeconds: 10 }] }, confirmed: { comments: [{ atSeconds: 3, text: '直したB' }, comments[0]], scenes: [{ title: 'A', startSeconds: 1, endSeconds: 4 }, { title: 'B', startSeconds: 7, endSeconds: 10 }] } },
      { suggestion: { comments: [comments[0]], scenes: [] }, confirmed: { comments: [comments[0], { atSeconds: 8, text: '追加' }], scenes: [] } },
    ]);
    expect(stats).toEqual({ comments: { unchanged: 2, edited: 1, deleted: 1, added: 1 }, scenes: { unchanged: 0, edited: 2, deleted: 0, added: 0 }, meanSceneStartDeltaSeconds: 1.5, matchedScenes: 2 });
    expect(comments).toHaveLength(3);
  });
  it('counts an unrelated replacement as deleted/added and keeps scene-title correspondence after deletion', () => {
    expect(aggregateAutoEditStats([{ suggestion: { comments: [{ atSeconds: 0, text: 'A' }, { atSeconds: 4, text: 'B' }], scenes: [{ title: 'A', startSeconds: 0, endSeconds: 5 }, { title: 'B', startSeconds: 10, endSeconds: 15 }, { title: 'C', startSeconds: 20, endSeconds: 25 }] }, confirmed: { comments: [{ atSeconds: 0, text: 'A' }, { atSeconds: 8, text: 'C' }], scenes: [{ title: 'A', startSeconds: 0, endSeconds: 5 }, { title: 'C', startSeconds: 22, endSeconds: 25 }] } }]))
      .toEqual({ comments: { unchanged: 1, edited: 0, deleted: 1, added: 1 }, scenes: { unchanged: 1, edited: 1, deleted: 1, added: 0 }, meanSceneStartDeltaSeconds: 1, matchedScenes: 2 });
  });
  it('matches moved captions and duplicate text at most once; ignores malformed persisted rows', () => {
    expect(aggregateAutoEditStats([{ suggestion: { comments: [{ atSeconds: 0, text: 'A' }, { atSeconds: 2, text: 'A' }], scenes: [] }, confirmed: { comments: [{ atSeconds: 3, text: 'A' }], scenes: [] } }, { suggestion: {}, confirmed: null }]))
      .toEqual({ comments: { unchanged: 0, edited: 1, deleted: 1, added: 0 }, scenes: { unchanged: 0, edited: 0, deleted: 0, added: 0 }, meanSceneStartDeltaSeconds: null, matchedScenes: 0 });
    expect(aggregateAutoEditStats([]).meanSceneStartDeltaSeconds).toBeNull();
  });
});

describe('procedure-video scene overlap classification', () => {
  const a = { title: '同じ題名', startSeconds: 0, endSeconds: 5 };
  const b = { title: '同じ題名', startSeconds: 10, endSeconds: 15 };
  it.each([
    { title: '改題', startSeconds: 10, endSeconds: 15 },
    { title: '同じ題名', startSeconds: 11, endSeconds: 15 },
    { title: '同じ題名', startSeconds: 10, endSeconds: 14 },
  ])('classifies a title/start/end edit by overlap: %j', (changed) => {
    expect(aggregateAutoEditStats([{ suggestion: { comments: [], scenes: [a, b, { ...a, startSeconds: 20, endSeconds: 25 }] },
      confirmed: { comments: [], scenes: [changed, a, { ...a, startSeconds: 30, endSeconds: 35 }] } }]).scenes)
      .toEqual({ unchanged: 1, edited: 1, deleted: 1, added: 1 });
  });
  it('does not match merely touching or disjoint intervals, even with identical titles', () => {
    expect(matchAutoEditScenes([a], [{ ...a, startSeconds: 5, endSeconds: 10 }])).toEqual([]);
    expect(aggregateAutoEditStats([{ suggestion: { comments: [], scenes: [a] }, confirmed: { comments: [], scenes: [b] } }]))
      .toMatchObject({ scenes: { unchanged: 0, edited: 0, deleted: 1, added: 1 }, meanSceneStartDeltaSeconds: null, matchedScenes: 0 });
  });
  it('matches split/merged intervals one-to-one by greatest overlap and leaves inputs unchanged', () => {
    const before = [a], after = [{ ...a, endSeconds: 2 }, { ...a, startSeconds: 2 }];
    const snapshot = structuredClone({ before, after });
    expect(matchAutoEditScenes(before, after)).toEqual([{ proposed: 0, confirmed: 1, overlap: 3 }]);
    expect(matchAutoEditScenes(after, before)).toEqual([{ proposed: 1, confirmed: 0, overlap: 3 }]);
    expect({ before, after }).toEqual(snapshot);
  });
});
