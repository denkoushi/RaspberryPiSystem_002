import type * as tls from 'tls';
import { describe, expect, it } from 'vitest';
import { verifyDropboxCertificate } from '../dropbox-cert-pinning.js';

const certWithFingerprint = (fingerprint256: string) =>
  ({ fingerprint256 }) as unknown as tls.PeerCertificate;

describe('verifyDropboxCertificate', () => {
  it.each([
    ['api.dropboxapi.com', 'F8:A1:8F:0F:0D:4D:84:87:9A:6C:13:12:ED:86:72:25:B7:72:F9:BC:CE:BD:DB:1E:7C:12:7A:C3:E8:D9:52:69'],
    ['content.dropboxapi.com', '1A:28:B5:1E:8B:0C:B4:CB:A2:E8:04:F2:CE:BA:BB:6B:53:41:62:3D:DB:7B:15:E6:81:F3:48:92:64:B9:C8:48'],
    ['notify.dropboxapi.com', 'F7:68:F5:57:16:16:81:88:2A:F5:0D:A2:A8:15:E0:7B:98:9F:C3:8D:CA:92:1E:E0:3D:98:FB:B9:AE:2D:7A:0B']
  ])('accepts the certificate %s has served since 2026-11-05', (servername, fingerprint) => {
    expect(verifyDropboxCertificate(servername, certWithFingerprint(fingerprint))).toBeUndefined();
  });

  it('rejects an unknown certificate for a Dropbox API host', () => {
    const unknown = '00:'.repeat(31) + '00';
    const result = verifyDropboxCertificate('content.dropboxapi.com', certWithFingerprint(unknown));
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toContain('Certificate pinning failed for content.dropboxapi.com');
  });

  it('leaves hosts outside dropboxapi.com to the default verification', () => {
    const unknown = '00:'.repeat(31) + '00';
    expect(verifyDropboxCertificate('api.dropbox.com', certWithFingerprint(unknown))).toBeUndefined();
  });
});
