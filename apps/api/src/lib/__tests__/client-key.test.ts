import { describe, expect, it } from 'vitest';

import { normalizeClientKey } from '../client-key.js';

describe('normalizeClientKey', () => {
  it('returns a plain string key unchanged', () => {
    expect(normalizeClientKey('client-key-raspberrypi4-kiosk1')).toBe('client-key-raspberrypi4-kiosk1');
  });

  it('unwraps a JSON-quoted key (as sent by some kiosk clients)', () => {
    expect(normalizeClientKey('"client-key-abc"')).toBe('client-key-abc');
  });

  it('keeps the raw string when JSON parses to a non-string value', () => {
    expect(normalizeClientKey('123')).toBe('123');
    expect(normalizeClientKey('true')).toBe('true');
    expect(normalizeClientKey('null')).toBe('null');
    expect(normalizeClientKey('{"key":"x"}')).toBe('{"key":"x"}');
    expect(normalizeClientKey('["x"]')).toBe('["x"]');
  });

  it('keeps the raw string when it is not valid JSON', () => {
    expect(normalizeClientKey('"unterminated')).toBe('"unterminated');
    expect(normalizeClientKey("'single'")).toBe("'single'");
  });

  it('does not trim surrounding whitespace', () => {
    expect(normalizeClientKey(' key ')).toBe(' key ');
  });

  it('returns an empty string for an empty header (callers must treat it as missing)', () => {
    expect(normalizeClientKey('')).toBe('');
    expect(normalizeClientKey('""')).toBe('');
  });

  it('uses the first element of a repeated header without JSON-unwrapping it', () => {
    expect(normalizeClientKey(['first', 'second'])).toBe('first');
    expect(normalizeClientKey(['"quoted"'])).toBe('"quoted"');
  });

  it('returns undefined for missing or non-string values', () => {
    expect(normalizeClientKey(undefined)).toBeUndefined();
    expect(normalizeClientKey(null)).toBeUndefined();
    expect(normalizeClientKey(42)).toBeUndefined();
    expect(normalizeClientKey([])).toBeUndefined();
    expect(normalizeClientKey([1, 'x'])).toBeUndefined();
    expect(normalizeClientKey({ key: 'x' })).toBeUndefined();
  });
});
