import type { SignageWebCapture, User } from '@prisma/client';

import { env } from '../../../config/env.js';
import { signAccessToken } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { WebCaptureStorage } from './web-capture-storage.js';
import { validateWebCapturePath } from './web-capture-path.js';
import {
  PlaywrightWebPageCapturer,
  isSafeHideSelector,
  type WebCaptureAuth,
  type WebCaptureWaitMode,
  type WebPageCaptureResult,
  type WebPageCapturer,
} from './web-page-capturer.js';

export const WEB_CAPTURE_REFRESH_INTERVALS = [60, 300, 900] as const;

export interface WebCaptureSettings {
  path: string;
  viewportWidth: number;
  viewportHeight: number;
  waitMode: WebCaptureWaitMode;
  waitSeconds: number;
  hideSelectors: string[];
  clipSelector: string | null;
}

export interface WebCaptureInput extends WebCaptureSettings {
  name: string;
  refreshIntervalSeconds: number;
  enabled: boolean;
}

export interface WebCaptureReference {
  scheduleId: string;
  scheduleName: string;
}

type LayoutOwner = { id: string; name: string; layoutConfig: unknown };

/** layoutConfig（JSON）から `web_page` スロットが参照する撮影コンテンツ ID を取り出す（純関数） */
export function extractWebCaptureIds(layoutConfig: unknown): string[] {
  if (!layoutConfig || typeof layoutConfig !== 'object') return [];
  const slots = (layoutConfig as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return [];
  const ids: string[] = [];
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') continue;
    const { kind, config } = slot as { kind?: unknown; config?: unknown };
    if (kind !== 'web_page' || !config || typeof config !== 'object') continue;
    const id = (config as { webCaptureId?: unknown }).webCaptureId;
    if (typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids;
}

/** 定期撮影の対象か（純関数）。有効・参照あり・期限切れのものだけを撮る。 */
export function isWebCaptureDue(
  capture: Pick<SignageWebCapture, 'id' | 'enabled' | 'lastCapturedAt' | 'refreshIntervalSeconds'>,
  referencedIds: ReadonlySet<string>,
  now: Date,
): boolean {
  if (!capture.enabled || !referencedIds.has(capture.id)) return false;
  if (!capture.lastCapturedAt) return true;
  return now.getTime() - capture.lastCapturedAt.getTime() >= capture.refreshIntervalSeconds * 1000;
}

/** DB 行から撮影設定を取り出す（waitMode は不明値を network_idle に寄せる） */
export function settingsOf(capture: SignageWebCapture): WebCaptureSettings {
  return {
    path: capture.path,
    viewportWidth: capture.viewportWidth,
    viewportHeight: capture.viewportHeight,
    waitMode: capture.waitMode === 'fixed_delay' ? 'fixed_delay' : 'network_idle',
    waitSeconds: capture.waitSeconds,
    hideSelectors: capture.hideSelectors,
    clipSelector: capture.clipSelector,
  };
}

export interface SignageWebCaptureServiceDeps {
  capturer: WebPageCapturer;
  storage: typeof WebCaptureStorage;
  getBaseUrl: () => string | undefined;
  getCaptureUsername: () => string | undefined;
  findUserByUsername: (username: string) => Promise<Pick<User, 'id' | 'username' | 'role' | 'status'> | null>;
  signToken: (user: Pick<User, 'id' | 'username' | 'role'>) => string;
}

function defaultDeps(): SignageWebCaptureServiceDeps {
  return {
    capturer: new PlaywrightWebPageCapturer(),
    storage: WebCaptureStorage,
    getBaseUrl: () => env.SIGNAGE_WEB_CAPTURE_BASE_URL,
    getCaptureUsername: () => env.SIGNAGE_WEB_CAPTURE_USERNAME,
    findUserByUsername: (username) =>
      prisma.user.findUnique({
        where: { username },
        select: { id: true, username: true, role: true, status: true },
      }),
    signToken: (user) => signAccessToken(user as User),
  };
}

export class SignageWebCaptureService {
  private readonly deps: SignageWebCaptureServiceDeps;
  /** 撮影は Pi5 の負荷を抑えるため常に 1 件ずつ実行する */
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(deps: Partial<SignageWebCaptureServiceDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  async list(): Promise<SignageWebCapture[]> {
    return prisma.signageWebCapture.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async get(id: string): Promise<SignageWebCapture> {
    const capture = await prisma.signageWebCapture.findUnique({ where: { id } });
    if (!capture) throw new ApiError(404, 'ページ撮影コンテンツが見つかりません');
    return capture;
  }

  async create(input: WebCaptureInput): Promise<SignageWebCapture> {
    this.assertSettings(input);
    return prisma.signageWebCapture.create({ data: { ...input } });
  }

  async update(id: string, input: Partial<WebCaptureInput>): Promise<SignageWebCapture> {
    const current = await this.get(id);
    this.assertSettings({ ...settingsOf(current), ...input });
    const settingsChanged = (['path', 'viewportWidth', 'viewportHeight', 'waitMode', 'waitSeconds', 'hideSelectors', 'clipSelector'] as const)
      .some((key) => input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(current[key]));
    return prisma.signageWebCapture.update({
      where: { id },
      // 設定が変わったら次の定期撮影ですぐ撮り直す
      data: { ...input, ...(settingsChanged ? { lastCapturedAt: null } : {}) },
    });
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    const references = await this.findReferences(id);
    if (references.length > 0) {
      throw new ApiError(
        409,
        `予定で使われているため削除できません（${references.map((r) => r.scheduleName).join('、')}）`,
        { references },
        'SIGNAGE_WEB_CAPTURE_IN_USE',
      );
    }
    await prisma.signageWebCapture.delete({ where: { id } });
    await this.deps.storage.remove(id);
  }

  async findReferences(id: string): Promise<WebCaptureReference[]> {
    const owners = await this.loadLayoutOwners(false);
    return owners
      .filter((owner) => extractWebCaptureIds(owner.layoutConfig).includes(id))
      .map((owner) => ({ scheduleId: owner.id, scheduleName: owner.name }));
  }

  async readImage(id: string): Promise<Buffer | null> {
    return this.deps.storage.read(id);
  }

  /** 保存せずに撮影する（追加・編集パネルのプレビュー用） */
  async captureOnce(settings: WebCaptureSettings): Promise<WebPageCaptureResult> {
    this.assertSettings(settings);
    return this.enqueue(() => this.runCapture(settings));
  }

  /** 撮影して最新画像と結果を保存する。失敗しても例外にせず、結果を記録して返す。 */
  async captureAndStore(id: string): Promise<SignageWebCapture> {
    const capture = await this.get(id);
    return this.enqueue(async () => {
      const startedAt = Date.now();
      try {
        const result = await this.runCapture(settingsOf(capture));
        await this.deps.storage.save(id, result.jpeg);
        return await prisma.signageWebCapture.update({
          where: { id },
          data: {
            lastCapturedAt: new Date(),
            lastStatus: 'success',
            lastError: null,
            lastDurationMs: result.durationMs,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error, webCaptureId: id }, 'Signage web capture failed');
        return await prisma.signageWebCapture.update({
          where: { id },
          data: {
            lastCapturedAt: new Date(),
            lastStatus: 'failed',
            lastError: message.slice(0, 500),
            lastDurationMs: Date.now() - startedAt,
          },
        });
      }
    });
  }

  /** 定期撮影。有効な予定・緊急表示から参照され、更新間隔を過ぎたものだけを順に撮る。 */
  async runDueCaptures(now: Date = new Date()): Promise<number> {
    if (!this.deps.getBaseUrl() || !this.deps.getCaptureUsername()) return 0;
    const owners = await this.loadLayoutOwners(true);
    const referenced = new Set(owners.flatMap((owner) => extractWebCaptureIds(owner.layoutConfig)));
    if (referenced.size === 0) return 0;
    const captures = await prisma.signageWebCapture.findMany({
      where: { enabled: true, id: { in: [...referenced] } },
    });
    const due = captures.filter((capture) => isWebCaptureDue(capture, referenced, now));
    for (const capture of due) {
      await this.captureAndStore(capture.id);
    }
    return due.length;
  }

  private async loadLayoutOwners(enabledOnly: boolean): Promise<LayoutOwner[]> {
    const [schedules, emergencies] = await Promise.all([
      prisma.signageSchedule.findMany({
        where: enabledOnly ? { enabled: true } : undefined,
        select: { id: true, name: true, layoutConfig: true },
      }),
      prisma.signageEmergency.findMany({
        where: enabledOnly ? { enabled: true } : undefined,
        select: { id: true, layoutConfig: true },
      }),
    ]);
    return [...schedules, ...emergencies.map((e) => ({ id: e.id, name: '緊急表示', layoutConfig: e.layoutConfig }))];
  }

  private assertSettings(settings: WebCaptureSettings & { refreshIntervalSeconds?: number }): void {
    // 起点 URL が未設定でも、パスの形だけは同一オリジン検証できるよう仮の起点で確かめる
    const validation = validateWebCapturePath(settings.path, this.deps.getBaseUrl() ?? 'http://web.invalid');
    if (!validation.ok) throw new ApiError(400, validation.reason, undefined, 'SIGNAGE_WEB_CAPTURE_INVALID_PATH');
    const unsafe = settings.hideSelectors.find((selector) => !isSafeHideSelector(selector));
    if (unsafe !== undefined) {
      throw new ApiError(400, '隠す部分の指定に使えない文字が含まれています', undefined, 'SIGNAGE_WEB_CAPTURE_INVALID_SELECTOR');
    }
    if (settings.clipSelector !== null && !isSafeHideSelector(settings.clipSelector)) {
      throw new ApiError(400, '切り出す部分の指定に使えない文字が含まれています', undefined, 'SIGNAGE_WEB_CAPTURE_INVALID_SELECTOR');
    }
  }

  private async runCapture(settings: WebCaptureSettings): Promise<WebPageCaptureResult> {
    const baseUrl = this.deps.getBaseUrl();
    if (!baseUrl) {
      throw new ApiError(503, '撮影先（SIGNAGE_WEB_CAPTURE_BASE_URL）が未設定です', undefined, 'SIGNAGE_WEB_CAPTURE_NOT_CONFIGURED');
    }
    const validation = validateWebCapturePath(settings.path, baseUrl);
    if (!validation.ok) throw new ApiError(400, validation.reason, undefined, 'SIGNAGE_WEB_CAPTURE_INVALID_PATH');
    const auth = await this.resolveAuth();
    return this.deps.capturer.capture({
      url: validation.url,
      viewportWidth: settings.viewportWidth,
      viewportHeight: settings.viewportHeight,
      waitMode: settings.waitMode,
      waitSeconds: settings.waitSeconds,
      hideSelectors: settings.hideSelectors,
      clipSelector: settings.clipSelector,
      auth,
    });
  }

  /** 撮影専用ユーザー（MANAGER のみ）の短命トークンを作る。パスワードは扱わない。 */
  private async resolveAuth(): Promise<WebCaptureAuth> {
    const username = this.deps.getCaptureUsername();
    if (!username) {
      throw new ApiError(503, '撮影用ユーザー（SIGNAGE_WEB_CAPTURE_USERNAME）が未設定です', undefined, 'SIGNAGE_WEB_CAPTURE_NOT_CONFIGURED');
    }
    const user = await this.deps.findUserByUsername(username);
    if (!user || user.status !== 'ACTIVE') {
      throw new ApiError(503, '撮影用ユーザーが見つからないか無効です', undefined, 'SIGNAGE_WEB_CAPTURE_USER_UNAVAILABLE');
    }
    if (user.role !== 'MANAGER') {
      throw new ApiError(503, '撮影用ユーザーの権限は MANAGER にしてください', undefined, 'SIGNAGE_WEB_CAPTURE_USER_ROLE');
    }
    return {
      token: this.deps.signToken(user),
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queueTail.then(task, task);
    this.queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

let sharedService: SignageWebCaptureService | null = null;

/** API プロセス内で直列キューを共有するための単一インスタンス */
export function getSignageWebCaptureService(): SignageWebCaptureService {
  sharedService ??= new SignageWebCaptureService();
  return sharedService;
}
