import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { watchCameraEnvShape } from './watch-camera.js';

const schema = z.object(watchCameraEnvShape);
describe('watch camera environment', () => {
  it('defaults prompt, confidence, intervals, retention, and storage capacity', () => {
    expect(schema.parse({})).toEqual({
      WATCH_CAMERA_PERSON_PROMPT: 'この写真に人が写っていますか。人の体の一部でも写っていれば true。',
      WATCH_CAMERA_PERSON_MIN_CONFIDENCE: 0.5, WATCH_CAMERA_JUDGE_INTERVAL_SEC: 30, WATCH_CAMERA_UNJUDGED_INTERVAL_SEC: 60,
      WATCH_CAMERA_SAMPLE_MAX_BYTES: 2 * 1024 ** 3, WATCH_CAMERA_RETENTION_DAYS: 30, WATCH_CAMERA_MAX_BYTES: 2 * 1024 ** 3, WATCH_CAMERA_JUDGE_ENHANCE: true });
  });
  it('accepts a custom prompt up to 1000 characters', () => {
    expect(schema.parse({ WATCH_CAMERA_PERSON_PROMPT: 'a'.repeat(1000) }).WATCH_CAMERA_PERSON_PROMPT).toBe('a'.repeat(1000));
    expect(schema.safeParse({ WATCH_CAMERA_PERSON_PROMPT: 'a'.repeat(1001) }).success).toBe(false);
  });
  it.each(['0', '0.5', '1'])('accepts confidence threshold %s', (value) => {
    expect(schema.parse({ WATCH_CAMERA_PERSON_MIN_CONFIDENCE: value }).WATCH_CAMERA_PERSON_MIN_CONFIDENCE).toBe(Number(value));
  });
  it.each(['-0.1', '1.1', 'NaN', 'Infinity'])('rejects confidence threshold %s', (value) => {
    expect(schema.safeParse({ WATCH_CAMERA_PERSON_MIN_CONFIDENCE: value }).success).toBe(false);
  });
  it('parses WATCH_CAMERA_JUDGE_ENHANCE as a boolean flag', () => {
    expect(schema.parse({ WATCH_CAMERA_JUDGE_ENHANCE: 'false' }).WATCH_CAMERA_JUDGE_ENHANCE).toBe(false);
    expect(schema.safeParse({ WATCH_CAMERA_JUDGE_ENHANCE: 'maybe' }).success).toBe(false);
  });
  it.each(Object.keys(watchCameraEnvShape).filter((key) => !key.startsWith('WATCH_CAMERA_PERSON_') && key !== 'WATCH_CAMERA_JUDGE_ENHANCE'))('coerces and validates %s', (key) => {
    expect(schema.parse({ [key]: '1' })).toHaveProperty(key, 1);
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', String(Number.MAX_SAFE_INTEGER + 1)]) {
      expect(schema.safeParse({ [key]: value }).success).toBe(false);
    }
  });
});
