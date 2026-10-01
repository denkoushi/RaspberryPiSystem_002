import type { Browser } from 'playwright';

import { logger } from '../../../lib/logger.js';
import { getSharedChromium } from '../loan-grid/playwright/playwright-browser-pool.js';

export type WebCaptureWaitMode = 'network_idle' | 'fixed_delay';

export interface WebCaptureAuth {
  token: string;
  user: { id: string; username: string; role: string };
}

export interface WebPageCaptureRequest {
  /** 検証済みの絶対 URL（validateWebCapturePath の結果） */
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  waitMode: WebCaptureWaitMode;
  waitSeconds: number;
  hideSelectors: string[];
  clipSelector: string | null;
  auth: WebCaptureAuth;
}

/** プレビュー上で「隠す部分」に選べる領域の候補 */
export interface WebCaptureRegion {
  selector: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebPageCaptureResult {
  jpeg: Buffer;
  regions: WebCaptureRegion[];
  durationMs: number;
}

export interface WebPageCapturer {
  capture(request: WebPageCaptureRequest): Promise<WebPageCaptureResult>;
}

/** 管理 Web がログイン状態を読む localStorage のキー（apps/web/src/contexts/AuthContext.tsx） */
const AUTH_STORAGE_KEY = 'factory-auth';
/** 撮影時は常に隠す要素（右下の Hermes ボタン） */
const ALWAYS_HIDDEN_SELECTORS = ['.hermes-floating-root'];
const NAVIGATION_TIMEOUT_MS = 20_000;
const LOADING_SETTLE_TIMEOUT_MS = 20_000;
const LOADING_TEXT = '読み込み中';
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSS セレクタを style タグへ埋め込む前の最小限の検査。
 * `{`、`}`、`<`、`;`、`@`、`\\` を含むものは規則の外へ出られるため受け付けない。
 */
export function isSafeHideSelector(selector: string): boolean {
  return selector.trim().length > 0 && selector.length <= 200 && !/[{}<;@\\]/.test(selector);
}

export function buildHideStyle(selectors: string[]): string {
  const all = [...ALWAYS_HIDDEN_SELECTORS, ...selectors.filter(isSafeHideSelector)];
  return `${all.join(',')}{display:none !important}`;
}

/**
 * ヘッドレス Chromium で管理 Web のページを撮影する。
 * - ログイン状態は localStorage へ事前注入する（パスワードは扱わない）
 * - 読み取り以外のリクエストはすべて中断し、撮影経路からデータが変わらないようにする
 */
export class PlaywrightWebPageCapturer implements WebPageCapturer {
  constructor(private readonly getBrowser: () => Promise<Browser> = getSharedChromium) {}

  async capture(request: WebPageCaptureRequest): Promise<WebPageCaptureResult> {
    const startedAt = Date.now();
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: request.viewportWidth, height: request.viewportHeight },
      deviceScaleFactor: 1,
    });
    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const authJson = JSON.stringify({ token: request.auth.token, user: request.auth.user, expiresAt });
      // 文字列で渡す（COLLECT_REGIONS_EXPRESSION と同じ理由）。値は JSON.stringify で安全に埋め込む。
      await context.addInitScript(
        `window.localStorage.setItem(${JSON.stringify(AUTH_STORAGE_KEY)}, ${JSON.stringify(authJson)});`,
      );
      await context.route('**/*', async (route) => {
        if (READ_ONLY_METHODS.has(route.request().method())) {
          await route.continue();
          return;
        }
        await route.abort('blockedbyclient');
      });

      const page = await context.newPage();
      await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      if (new URL(page.url()).pathname.startsWith('/login')) {
        throw new Error('ログイン画面に移動しました（撮影用ユーザーを確認してください）');
      }
      await page.addStyleTag({ content: buildHideStyle(request.hideSelectors) });

      if (request.waitMode === 'fixed_delay') {
        await page.waitForTimeout(Math.max(0, request.waitSeconds) * 1000);
      } else {
        await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
        await page
          .waitForFunction(
            `!document.body || !document.body.innerText.includes(${JSON.stringify(LOADING_TEXT)})`,
            undefined,
            { timeout: LOADING_SETTLE_TIMEOUT_MS },
          )
          .catch(() => {
            logger.warn({ url: request.url }, 'Web capture: loading text did not disappear before timeout');
          });
      }

      const regions = (await page.evaluate(COLLECT_REGIONS_EXPRESSION)) as WebCaptureRegion[];

      let jpeg: Buffer;
      if (request.clipSelector) {
        const target = page.locator(request.clipSelector).first();
        jpeg = await target.screenshot({ type: 'jpeg', quality: 88, timeout: NAVIGATION_TIMEOUT_MS });
      } else {
        jpeg = await page.screenshot({ type: 'jpeg', quality: 88 });
      }
      return { jpeg, regions, durationMs: Date.now() - startedAt };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

/**
 * ブラウザ内で実行する式。主要な領域の位置と、その要素を一意に指すセレクタを集める。
 * 関数ではなく文字列で渡す：tsx / vitest（esbuild）は関数に補助コード（__name）を差し込み、
 * ページ側で ReferenceError になるため。
 */
const COLLECT_REGIONS_EXPRESSION = `(() => {
  const labels = { header: '上部メニュー', nav: 'メニュー', aside: '横の欄', footer: '下部' };
  const selectorOf = (el) => {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 6) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
      parts.unshift(sameTag.length > 1 ? tag + ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')' : tag);
      current = parent;
    }
    return 'body > ' + parts.join(' > ');
  };
  const regions = [];
  const picked = [];
  document
    .querySelectorAll('header,nav,aside,footer,[role=banner],[role=navigation],[role=complementary]')
    .forEach((el) => {
      // ページ全体の枠だけを候補にする：本文（main）の中や、すでに候補にした要素の中は除く
      if (el.closest('main')) return;
      if (picked.some((parent) => parent !== el && parent.contains(el))) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 16) return;
      picked.push(el);
      regions.push({
        selector: selectorOf(el),
        label: labels[el.tagName.toLowerCase()] || '領域',
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    });
  return regions.slice(0, 12);
})()`;
