import { describe, expect, it } from 'vitest';

import {
  classifyVlmHttp400SubReason,
  isLikelyVlmImageLoadOrDecodeHttp400,
} from '../vision-vlm-fallback.util.js';

describe('vision-vlm-fallback.util', () => {
  it('detects decode-like 400 bodies', () => {
    expect(isLikelyVlmImageLoadOrDecodeHttp400(400, 'Failed to load image: x')).toBe(true);
    expect(isLikelyVlmImageLoadOrDecodeHttp400(400, 'cannot identify image file')).toBe(true);
    expect(isLikelyVlmImageLoadOrDecodeHttp400(502, 'Failed to load image')).toBe(false);
    expect(isLikelyVlmImageLoadOrDecodeHttp400(400, 'unrelated bad request')).toBe(false);
  });

  it('classifies 400 sub-reasons', () => {
    expect(classifyVlmHttp400SubReason(400, 'too large max pixels')).toBe('size');
    expect(classifyVlmHttp400SubReason(400, 'Failed to load image')).toBe('image_decode');
    expect(classifyVlmHttp400SubReason(400, 'generic')).toBe('unknown');
  });
});
