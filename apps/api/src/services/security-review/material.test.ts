import { describe, expect, it } from 'vitest';
import { MATERIAL_BYTES, prepareChunks, redact, redactCode, splitBytes } from './material.js';

// Fixed examples are mirrored in test_security_review_collect.py.
describe('Security/error UTF-8 chunk counts', () => {
  it.each([
    { text: '', count: 0 },
    { text: 'a'.repeat(8000), count: 1 },
    { text: 'a'.repeat(8001), count: 2 },
    { text: ('a'.repeat(4000) + '\n').repeat(3), count: 2 },
    { text: '界'.repeat(5333), count: 3 },
    { text: 'a'.repeat(7999) + '界', count: 2 },
    { text: '😀'.repeat(2000), count: 1 },
    { text: '😀'.repeat(2001), count: 2 },
    { text: 'a'.repeat(7999) + '\r\n\nlast', count: 2 },
  ])('matches the collector count for fixed example %#', ({ text, count }) => {
    const chunks = splitBytes(text);
    expect(chunks).toHaveLength(count);
    expect(chunks.join('')).toBe(text);
  });
});

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

  it('keeps all eight collector changes chunks even when both other sources saturate the budget', () => {
    const changes = ('+'.repeat(MATERIAL_BYTES - 1) + '\n').repeat(8);
    const prepared = prepareChunks({ security: 's'.repeat(MATERIAL_BYTES * 30),
      errors: 'e'.repeat(MATERIAL_BYTES * 30), changes });
    expect(prepared.truncated.changes).toBe(0);
    expect(prepared.chunks.filter(chunk => chunk.kind === 'changes')).toHaveLength(8);
  });

  it('keeps the expanded collector budget when security and errors each use one chunk', () => {
    const prepared = prepareChunks({ security: 'security', errors: 'errors',
      changes: ('+'.repeat(MATERIAL_BYTES - 1) + '\n').repeat(22) });
    expect(prepared.chunks.filter(chunk => chunk.kind === 'changes')).toHaveLength(22);
    expect(prepared.truncated).toEqual({ security: 0, errors: 0, changes: 0 });
  });

  // Fixed examples are mirrored in test_security_review_collect.py.
  it.each([
    { changes: '', count: 0 },
    { changes: ('a'.repeat(3999) + '\n').repeat(2), count: 1 },
    { changes: ('a'.repeat(4000) + '\n').repeat(2), count: 2 },
    { changes: '界'.repeat(2666) + '\n+x', count: 2 },
    { changes: '界'.repeat(5333), count: 3 },
    { changes: '+first\n' + '界'.repeat(2667) + '\n+last\n', count: 3 },
    { changes: 'a'.repeat(7999) + '\r\n\nlast', count: 2 },
    { changes: 'a\u2028b\rc\nlast', count: 1 },
  ])('matches the collector count for fixed example %#', ({ changes, count }) => {
    const prepared = prepareChunks({ security: '', errors: '', changes });
    expect(prepared.chunks).toHaveLength(count);
    expect(prepared.chunks.map(chunk => chunk.text).join('')).toBe(changes);
    for (const chunk of prepared.chunks) expect(Buffer.byteLength(chunk.text, 'utf8')).toBeLessThanOrEqual(MATERIAL_BYTES);
  });

  it('packs many small files into a few chunks', () => {
    const changes = Array.from({ length: 164 }, (_, index) =>
      `diff --git a/${index} b/${index}\n+${'x'.repeat(100)}\n`).join('');
    const prepared = prepareChunks({ security: '', errors: '', changes });
    expect(prepared.chunks.map(chunk => chunk.id)).toEqual(['changes-1', 'changes-2', 'changes-3']);
    expect(prepared.chunks.map(chunk => chunk.text).join('')).toBe(changes);
    expect(prepared.truncated.changes).toBe(0);
  });

  it('keeps ordinary UTF-8 lines intact including newlines', () => {
    const lines = ['界'.repeat(2000) + '\n', '+second\r\n', '+'.repeat(3000) + '\n', '+last'];
    const prepared = prepareChunks({ security: '', errors: '', changes: lines.join('') });
    expect(prepared.chunks.map(chunk => chunk.text)).toEqual([lines[0]! + lines[1]!, lines[2]! + lines[3]!]);
  });

  it('splits only an oversized line on UTF-8 character boundaries', () => {
    const changes = '+first\n' + '界'.repeat(2667) + '\n+last\n';
    const prepared = prepareChunks({ security: '', errors: '', changes });
    expect(prepared.chunks.map(chunk => chunk.text)).toEqual([
      '+first\n', '界'.repeat(2666), '界\n+last\n',
    ]);
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
