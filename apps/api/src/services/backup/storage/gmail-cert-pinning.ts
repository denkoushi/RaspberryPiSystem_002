import * as https from 'https';
import * as tls from 'tls';
import { logger } from '../../../lib/logger.js';

/**
 * Gmail APIの証明書フィンガープリント（SHA256）
 * 
 * 取得方法:
 * 1. openssl s_client -connect gmail.googleapis.com:443 -showcerts < /dev/null 2>/dev/null | openssl x509 -fingerprint -sha256 -noout
 * 2. または、pnpm exec tsx apps/api/scripts/get-gmail-cert-fingerprint.ts を実行
 * 
 * 注意: 証明書が更新された場合は、この値を更新する必要があります。
 * 
 * 現在の証明書情報（2025-12-24時点）:
 * - Issuer: Google Trust Services LLC
 * - 取得日: 2025-12-24
 */
const GMAIL_CERTIFICATE_FINGERPRINTS = [
  'sha256/8Rw90Ej3Ttt8RRkrg+WYDS9n7IS03e5GNsJxFOdJMjU', // gmail.googleapis.com
  'sha256/Ko8tivDrEjiY90y1P9QGnwEIOZ11DJ+Z3ROvG9G7KqU', // oauth2.googleapis.com
  'sha256/5PjojDK5D8X5RqdvXU24k6B4e1l2xZQ6D5wJ4N8K9L0'  // accounts.google.com
] as const;

/**
 * Gmail APIの証明書ピニング検証関数
 * 
 * @param servername - サーバー名（gmail.googleapis.com, oauth2.googleapis.com, accounts.google.com）
 * @param cert - TLS証明書
 * @returns undefined（検証成功）またはError（検証失敗）
 */
export function verifyGmailCertificate(
  servername: string,
  cert: tls.PeerCertificate
): Error | undefined {
  // Gmail API関連のドメインのみ検証
  if (!servername.includes('googleapis.com') && !servername.includes('accounts.google.com')) {
    return undefined; // 他のドメインはデフォルトの検証に委譲
  }

  // 証明書フィンガープリントが設定されていない場合は警告のみ
  if ((GMAIL_CERTIFICATE_FINGERPRINTS as readonly string[]).length === 0) {
    logger?.warn(
      { servername, fingerprint: cert.fingerprint256 },
      '[GmailCertPinning] Certificate fingerprints not configured, skipping pinning'
    );
    return undefined; // ピニングが設定されていない場合はスキップ
  }

  // 証明書フィンガープリントを正規化（コロンを削除、小文字に変換）
  const normalizeFingerprint = (fp: string): string => {
    return fp.replace(/:/g, '').toLowerCase();
  };

  const certFingerprint = normalizeFingerprint(cert.fingerprint256);
  const isValid = GMAIL_CERTIFICATE_FINGERPRINTS.some(
    expected => normalizeFingerprint(expected.replace('sha256/', '')) === certFingerprint
  );

  if (!isValid) {
    const error = new Error(
      `Certificate pinning failed for ${servername}: ` +
      `expected one of ${GMAIL_CERTIFICATE_FINGERPRINTS.join(', ')}, ` +
      `got sha256/${cert.fingerprint256}`
    );
    logger?.error(
      {
        servername,
        expected: GMAIL_CERTIFICATE_FINGERPRINTS,
        actual: `sha256/${cert.fingerprint256}`,
        normalized: certFingerprint
      },
      '[GmailCertPinning] Certificate pinning verification failed'
    );
    return error;
  }

  logger?.debug(
    { servername, fingerprint: certFingerprint },
    '[GmailCertPinning] Certificate pinning verification passed'
  );
  return undefined; // 検証成功
}

/**
 * Gmail APIの証明書フィンガープリントを取得する（開発・設定用）
 * 
 * 使用方法:
 * ```typescript
 * const fingerprint = await getGmailCertificateFingerprint('gmail.googleapis.com');
 * console.log(`Gmail certificate fingerprint: sha256/${fingerprint}`);
 * ```
 */
export async function getGmailCertificateFingerprint(hostname: string = 'gmail.googleapis.com'): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname,
      port: 443,
      path: '/',
      method: 'HEAD',
      rejectUnauthorized: false // 一時的に無効化して証明書を取得
    };

    const req = https.request(options, (res) => {
      const socket = res.socket as tls.TLSSocket;
      const cert = socket.getPeerCertificate(true);
      if (cert && cert.fingerprint256) {
        resolve(cert.fingerprint256);
      } else {
        reject(new Error('Could not get certificate fingerprint'));
      }
      res.destroy();
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}
