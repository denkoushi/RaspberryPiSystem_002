#!/usr/bin/env node
/**
 * Dropbox APIの証明書フィンガープリントを取得するスクリプト
 *
 * 使用方法:
 *   pnpm tsx apps/api/scripts/get-dropbox-cert-fingerprint.ts
 *
 * 出力されたフィンガープリントを dropbox-cert-pinning.ts の
 * DROPBOX_CERTIFICATE_FINGERPRINTS に追加してください。
 */
import * as https from 'https';
async function getCertificateFingerprint(hostname) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname,
            port: 443,
            path: '/',
            method: 'HEAD',
            rejectUnauthorized: false // 一時的に無効化して証明書を取得
        };
        const req = https.request(options, (res) => {
            const socket = res.socket;
            const cert = socket.getPeerCertificate(true);
            if (cert && cert.fingerprint256) {
                // コロン区切りを削除して小文字に変換
                const fingerprint = cert.fingerprint256.replace(/:/g, '').toLowerCase();
                resolve(fingerprint);
            }
            else {
                reject(new Error('Could not get certificate fingerprint'));
            }
            res.destroy();
        });
        req.on('error', (err) => {
            reject(err);
        });
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}
async function main() {
    const hostnames = ['api.dropboxapi.com', 'content.dropboxapi.com', 'notify.dropboxapi.com'];
    console.log('Dropbox API証明書フィンガープリント取得中...\n');
    for (const hostname of hostnames) {
        try {
            const fingerprint = await getCertificateFingerprint(hostname);
            console.log(`${hostname}:`);
            console.log(`  sha256/${fingerprint}`);
            console.log();
        }
        catch (error) {
            console.error(`Failed to get fingerprint for ${hostname}:`, error);
        }
    }
    console.log('取得したフィンガープリントを dropbox-cert-pinning.ts の');
    console.log('DROPBOX_CERTIFICATE_FINGERPRINTS 配列に追加してください。');
}
main().catch(console.error);
//# sourceMappingURL=get-dropbox-cert-fingerprint.js.map