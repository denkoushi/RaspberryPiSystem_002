/**
 * ページ撮影の対象パス検証（純関数）。
 *
 * 撮影は API サーバー内のブラウザから行うため、任意 URL を許すと社内の他サービスへ
 * API 経由でアクセスさせる穴（SSRF）になる。対象は管理 Web 自身のパスだけに限定する。
 */

export type WebCapturePathValidation = { ok: true; url: string } | { ok: false; reason: string };

const MAX_PATH_LENGTH = 500;

export function validateWebCapturePath(path: string, baseUrl: string): WebCapturePathValidation {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, reason: 'パスが空です' };
  }
  if (path.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: 'パスが長すぎます' };
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    return { ok: false, reason: 'パスは "/" で始まる管理画面内のパスにしてください' };
  }
  // バックスラッシュと制御文字は、ブラウザの URL 正規化で別ホスト扱いになり得る
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path)) {
    return { ok: false, reason: 'パスに使えない文字が含まれています' };
  }
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(baseUrl);
    resolved = new URL(path, base);
  } catch {
    return { ok: false, reason: 'パスを解釈できません' };
  }
  if (resolved.origin !== base.origin) {
    return { ok: false, reason: '管理画面の外は撮影できません' };
  }
  if (resolved.pathname.startsWith('/api/') || resolved.pathname === '/api') {
    return { ok: false, reason: 'API のパスは撮影できません' };
  }
  return { ok: true, url: resolved.toString() };
}
