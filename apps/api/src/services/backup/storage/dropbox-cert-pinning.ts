import * as https from 'https';
import * as tls from 'tls';
import { logger } from '../../../lib/logger.js';

/**
 * Dropbox APIの証明書フィンガープリント（SHA256）
 * 
 * 取得方法:
 * 1. openssl s_client -connect api.dropboxapi.com:443 -showcerts < /dev/null 2>/dev/null | openssl x509 -fingerprint -sha256 -noout
 * 2. または、pnpm exec tsx apps/api/scripts/get-dropbox-cert-fingerprint.ts を実行
 * 
 * 注意: 証明書が更新された場合は、この値を更新する必要があります。
 * 
 * 現在の証明書情報（2025-12-14時点）:
 * - Issuer: DigiCert TLS RSA SHA256 2020 CA1
 * - 取得日: 2025-12-14
 */
const DROPBOX_CERTIFICATE_FINGERPRINTS = [
  'sha256/df9a4cabca84f3de17c1f52b7247b95d7a3e1166dd1eb55a2f2917b29f9e7cad', // api.dropboxapi.com
  'sha256/4085a9c1e3f6bac2ae9e530e2679e2447655e840d07d7793b047a53ba760f9cc', // content.dropboxapi.com
  'sha256/5712473809f6c0a24a9cf7cb74dca93d760fc4ee90de1e17fa0224b12b5fea59'  // notify.dropboxapi.com
] as const;

/**
 * Dropbox APIの証明書ピニング検証関数
 * 
 * @param servername - サーバー名（api.dropboxapi.com）
 * @param cert - TLS証明書
 * @returns undefined（検証成功）またはError（検証失敗）
 */
export function verifyDropboxCertificate(
  servername: string,
  cert: tls.PeerCertificate
): Error | undefined {
  // Dropbox APIのドメインのみ検証
  if (!servername.includes('dropboxapi.com')) {
    return undefined; // 他のドメインはデフォルトの検証に委譲
  }

  // 証明書フィンガープリントが設定されていない場合は警告のみ
  // 注意: DROPBOX_CERTIFICATE_FINGERPRINTSは定数配列のため、この分岐は通常到達しない
  if ((DROPBOX_CERTIFICATE_FINGERPRINTS as readonly string[]).length === 0) {
    logger?.warn(
      { servername, fingerprint: cert.fingerprint256 },
      '[DropboxCertPinning] Certificate fingerprints not configured, skipping pinning'
    );
    return undefined; // ピニングが設定されていない場合はスキップ
  }

  // 証明書フィンガープリントを正規化（コロンを削除、小文字に変換）
  const normalizeFingerprint = (fp: string): string => {
    return fp.replace(/:/g, '').toLowerCase();
  };

  const certFingerprint = normalizeFingerprint(cert.fingerprint256);
  const isValid = DROPBOX_CERTIFICATE_FINGERPRINTS.some(
    expected => normalizeFingerprint(expected.replace('sha256/', '')) === certFingerprint
  );

  if (!isValid) {
    const error = new Error(
      `Certificate pinning failed for ${servername}: ` +
      `expected one of ${DROPBOX_CERTIFICATE_FINGERPRINTS.join(', ')}, ` +
      `got sha256/${cert.fingerprint256}`
    );
    logger?.error(
      {
        servername,
        expected: DROPBOX_CERTIFICATE_FINGERPRINTS,
        actual: `sha256/${cert.fingerprint256}`,
        normalized: certFingerprint
      },
      '[DropboxCertPinning] Certificate pinning verification failed'
    );
    return error;
  }

  logger?.debug(
    { servername, fingerprint: certFingerprint },
    '[DropboxCertPinning] Certificate pinning verification passed'
  );
  return undefined; // 検証成功
}

/**
 * Dropbox APIの証明書フィンガープリントを取得する（開発・設定用）
 * 
 * 使用方法:
 * ```typescript
 * const fingerprint = await getDropboxCertificateFingerprint();
 * console.log(`Dropbox certificate fingerprint: sha256/${fingerprint}`);
 * ```
 */
export async function getDropboxCertificateFingerprint(): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'api.dropboxapi.com',
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

