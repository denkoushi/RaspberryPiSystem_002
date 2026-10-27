import { describe, expect, it } from 'vitest';
import { MATERIAL_BYTES, prepareChunks, redact, redactCode } from './material.js';

describe('Review material chunk allocation', () => {
  it.each([
    { errors: 3, security: 19, truncated: 11 },
    { errors: 0, security: 22, truncated: 8 },
  ])('shares the budget with $errors error chunks', ({ errors, security, truncated }) => {
    const prepared = prepareChunks({ security: 's'.repeat(MATERIAL_BYTES * 30),
      errors: 'e'.repeat(MATERIAL_BYTES * errors), changes: 'c'.repeat(MATERIAL_BYTES * 2) });
    expect(prepared.chunks).toHaveLength(24);
    expect(prepared.truncated).toEqual({ security: truncated, errors: 0, changes: 0 });
    expect(prepared.chunks.map(chunk => chunk.id)).toEqual([
      ...Array.from({ length: security }, (_, index) => `security-${index + 1}`),
      ...Array.from({ length: errors }, (_, index) => `errors-${index + 1}`),
      'changes-1', 'changes-2',
    ]);
    for (const chunk of prepared.chunks) {
      expect(chunk.text).toBe(chunk.kind[0]!.repeat(MATERIAL_BYTES));
      expect(chunk.id).toMatch(new RegExp(`^${chunk.kind}-`));
    }
  });

  it('allocates one chunk per kind each round in priority order', () => {
    const prepared = prepareChunks({ security: 's'.repeat(MATERIAL_BYTES * 30),
      errors: 'e'.repeat(MATERIAL_BYTES * 30), changes: 'c'.repeat(MATERIAL_BYTES) });
    expect(prepared.chunks.filter(chunk => chunk.kind === 'security')).toHaveLength(12);
    expect(prepared.chunks.filter(chunk => chunk.kind === 'errors')).toHaveLength(11);
    expect(prepared.chunks.filter(chunk => chunk.kind === 'changes')).toHaveLength(1);
    expect(prepared.truncated).toEqual({ security: 18, errors: 19, changes: 0 });
  });

  it('returns no chunks or truncation for empty material', () => {
    expect(prepareChunks({ security: '', errors: '', changes: '' })).toEqual({
      chunks: [], truncated: { security: 0, errors: 0, changes: 0 },
    });
  });
});

describe('Review material redaction', () => {
  it('preserves the Caddy log record while stripping its query', () => {
    expect(redact('{"uri":"/api/x?token=abc","status":403}')).toBe('{"uri":"/api/x?[REDACTED]","status":403}');
  });
  it.each(['const value = a?.b;', 'foo?: string;', 'const value = x ?? y;',
    'commit ' + 'aB01234567'.repeat(4), 'sha256 ' + 'aB012345'.repeat(8)])('preserves code and hashes: %s', text => {
    expect(redact(text)).toBe(text);
  });

  it.each(['{"uri":"/api/x?token=abc"}', 'GET /api/x?value=abc HTTP/1.1',
    'https://example.test/api/x?value=abc', '/?value=abc'])('strips queries from request paths and URLs: %s', text => {
    expect(redact(text)).not.toContain('abc');
    expect(redact(text)).toContain('?[REDACTED]');
  });

  it.each(['Authorization: Bearer hidden', 'Bearer hidden', 'Cookie: session=hidden',
    'value=Gz7qR2mNp9Vx4Ks8Tj6Wc3Yh5Lb1Df0Ua2Pe9HrQ'])('redacts credentials: %s', text => {
    expect(redact(text)).toContain('[REDACTED]');
    expect(redact(text)).not.toContain('hidden');
    expect(redact(text)).not.toContain('Gz7qR2mNp9Vx4Ks8Tj6Wc3Yh5Lb1Df0Ua2Pe9HrQ');
  });
});

describe('Code material redaction', () => {
  it('preserves diff locations and auth code', () => {
    const name = 'apps/web/src/features/some-long-folder/SomeComponentName.test.tsx';
    const diff = `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n+  const accessToken = req.headers.authorization;\n`;
    expect(redactCode(diff)).toBe(diff);
  });

  it('redacts private keys inside diffs and URL credentials', () => {
    const key = '+-----BEGIN ' + 'PRIVATE KEY-----\n+private-data\n+-----END PRIVATE KEY-----';
    expect(redactCode(key)).toBe('+[REDACTED]');
    expect(redactCode('+https://user:hidden-password@example.test/path')).toBe('+https://[REDACTED]@example.test/path');
  });
});
