import { describe, expect, it } from 'vitest';

import { normalizePhotoToolDisplayName, PHOTO_TOOL_DISPLAY_NAME_MAX_LEN } from '../photo-tool-label-normalize.js';

describe('normalizePhotoToolDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizePhotoToolDisplayName('  ペンチ  ')).toBe('ペンチ');
    expect(normalizePhotoToolDisplayName('a  b')).toBe('a b');
  });

  it('removes newlines', () => {
    expect(normalizePhotoToolDisplayName('ペン\nチ')).toBe('ペンチ');
  });

  it('returns null for empty', () => {
    expect(normalizePhotoToolDisplayName('')).toBeNull();
    expect(normalizePhotoToolDisplayName('   ')).toBeNull();
  });

  it('clips to max length', () => {
    const long = 'あ'.repeat(PHOTO_TOOL_DISPLAY_NAME_MAX_LEN + 10);
    const out = normalizePhotoToolDisplayName(long);
    expect(out).toHaveLength(PHOTO_TOOL_DISPLAY_NAME_MAX_LEN);
  });

  it('strict: keeps text before first period-like delimiter', () => {
    expect(normalizePhotoToolDisplayName('ペンチ。これは工具です。', { strict: true })).toBe('ペンチ');
    expect(normalizePhotoToolDisplayName('マイクロメータ. extra', { strict: true })).toBe('マイクロメータ');
  });

  it('strict: trims trailing colon', () => {
    expect(normalizePhotoToolDisplayName('ノギス：', { strict: true })).toBe('ノギス');
  });
});
