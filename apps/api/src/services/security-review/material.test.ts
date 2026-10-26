import { describe, expect, it } from 'vitest';
import { redact, redactCode } from './material.js';

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
