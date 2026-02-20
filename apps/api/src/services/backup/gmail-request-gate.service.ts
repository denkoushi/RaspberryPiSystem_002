import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { isRecord, toErrorInfo } from '../../lib/type-guards.js';

export class GmailRateLimitedDeferredError extends Error {
  readonly cooldownUntil: Date;
  readonly retryAfterMs: number;
  readonly operation: string;

  constructor(params: { cooldownUntil: Date; retryAfterMs: number; operation: string; cause?: unknown }) {
    const iso = params.cooldownUntil.toISOString();
    super(`Gmail API is rate limited; deferred until ${iso}`);
    this.name = 'GmailRateLimitedDeferredError';
    this.cooldownUntil = params.cooldownUntil;
    this.retryAfterMs = params.retryAfterMs;
    this.operation = params.operation;
    (this as { cause?: unknown }).cause = params.cause;
  }

  toLogFields(): {
    operation: string;
    cooldownUntil: string;
    retryAfterMs: number;
  } {
    return {
      operation: this.operation,
      cooldownUntil: this.cooldownUntil.toISOString(),
      retryAfterMs: this.retryAfterMs,
    };
  }
}

type GmailRateLimitStateRow = {
  id: string;
  cooldownUntil: Date | null;
  last429At: Date | null;
  lastRetryAfterMs: number | null;
  version: number;
};

/**
 * Gmail APIの429（rate limit）をスケジュール横断で調停するゲート。
 *
 * - 429を受けたら `Retry-After` を抽出し、DBに cooldownUntil を保存
 * - cooldown中は実リクエストを投げずに defer する（= 429を踏みに行かない）
 */
export class GmailRequestGateService {
  private static readonly STATE_ID = 'gmail:me';

  // DBへのアクセスを毎回行わないための軽いキャッシュ（正確性より過負荷防止を優先）
  private cachedCooldownUntil: Date | null = null;
  private cacheValidUntilEpochMs: number = 0;

  constructor(
    private readonly deps: {
      now?: () => Date;
      sleep?: (ms: number) => Promise<void>;
      cacheTtlMs?: number;
      jitterMaxMs?: number;
    } = {}
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    if (this.deps.sleep) {
      await this.deps.sleep(ms);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private cacheTtlMs(): number {
    // クールダウン中の「無駄なDB参照」を減らす程度で十分
    return this.deps.cacheTtlMs ?? 2000;
  }

  private jitterMaxMs(): number {
    // 同時に解除された場合の“再バースト”を避けるための小さなjitter
    return this.deps.jitterMaxMs ?? 1500;
  }

  async execute<T>(
    operation: string,
    fn: () => Promise<T>,
    opts: { allowWait: boolean }
  ): Promise<T> {
    const { allowWait } = opts;

    const cooldownUntil = await this.getCooldownUntil();
    const now = this.now();
    if (cooldownUntil && now.getTime() < cooldownUntil.getTime()) {
      const waitMs = cooldownUntil.getTime() - now.getTime();
      if (!allowWait) {
        throw new GmailRateLimitedDeferredError({
          operation,
          cooldownUntil,
          retryAfterMs: waitMs,
        });
      }
      await this.sleep(waitMs);
    }

    try {
      return await fn();
    } catch (error) {
      if (!isGmailRateLimitError(error)) {
        throw error;
      }

      const retryAfterMs = extractRetryAfterMs(error);
      const jitter = Math.floor(Math.random() * this.jitterMaxMs());
      const cooldownUntilNext = new Date(this.now().getTime() + retryAfterMs + jitter);

      try {
        await this.persistCooldown({
          cooldownUntil: cooldownUntilNext,
          last429At: this.now(),
          lastRetryAfterMs: retryAfterMs,
        });
      } catch (persistError) {
        // 永続化に失敗しても“今のリクエスト”は429なので、呼び出し元にはdeferを返す。
        logger?.error(
          { err: persistError, operation, cooldownUntilNext: cooldownUntilNext.toISOString(), retryAfterMs },
          '[GmailRequestGate] Failed to persist cooldown'
        );
      }

      logger?.warn(
        {
          operation,
          retryAfterMs,
          cooldownUntil: cooldownUntilNext.toISOString(),
        },
        '[GmailRequestGate] Rate limit detected; entering cooldown'
      );

      throw new GmailRateLimitedDeferredError({
        operation,
        cooldownUntil: cooldownUntilNext,
        retryAfterMs,
        cause: error,
      });
    }
  }

  private async getCooldownUntil(): Promise<Date | null> {
    const nowEpoch = this.now().getTime();
    if (nowEpoch < this.cacheValidUntilEpochMs) {
      return this.cachedCooldownUntil;
    }

    const row = await this.getOrCreateStateRow();
    const until = row.cooldownUntil ? new Date(row.cooldownUntil) : null;

    this.cachedCooldownUntil = until;
    this.cacheValidUntilEpochMs = nowEpoch + this.cacheTtlMs();
    return until;
  }

  private async getOrCreateStateRow(): Promise<GmailRateLimitStateRow> {
    const existing = await prisma.gmailRateLimitState.findUnique({
      where: { id: GmailRequestGateService.STATE_ID },
      select: {
        id: true,
        cooldownUntil: true,
        last429At: true,
        lastRetryAfterMs: true,
        version: true,
      },
    });
    if (existing) {
      return existing;
    }

    // 初回は作成（競合してもOK）
    try {
      return await prisma.gmailRateLimitState.create({
        data: { id: GmailRequestGateService.STATE_ID },
        select: {
          id: true,
          cooldownUntil: true,
          last429At: true,
          lastRetryAfterMs: true,
          version: true,
        },
      });
    } catch {
      // 競合した場合は読み直す
      const reloaded = await prisma.gmailRateLimitState.findUnique({
        where: { id: GmailRequestGateService.STATE_ID },
        select: {
          id: true,
          cooldownUntil: true,
          last429At: true,
          lastRetryAfterMs: true,
          version: true,
        },
      });
      if (!reloaded) {
        throw new Error('Failed to initialize GmailRateLimitState');
      }
      return reloaded;
    }
  }

  private async persistCooldown(params: {
    cooldownUntil: Date;
    last429At: Date;
    lastRetryAfterMs: number;
  }): Promise<void> {
    // CAS更新: 競合時は再読込して最大数回リトライ
    for (let i = 0; i < 5; i++) {
      const current = await this.getOrCreateStateRow();
      const res = await prisma.gmailRateLimitState.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          cooldownUntil: params.cooldownUntil,
          last429At: params.last429At,
          lastRetryAfterMs: params.lastRetryAfterMs,
          version: { increment: 1 },
        },
      });
      if (res.count === 1) {
        // キャッシュも更新（次のアクセスでDBを叩かない）
        this.cachedCooldownUntil = params.cooldownUntil;
        this.cacheValidUntilEpochMs = this.now().getTime() + this.cacheTtlMs();
        return;
      }
    }
    throw new Error('Failed to persist GmailRateLimitState (CAS retry exceeded)');
  }
}

function isGmailRateLimitError(error: unknown): boolean {
  const info = toErrorInfo(error);
  const message = (info.message ?? '').toLowerCase();
  const status = Number(info.status ?? info.code);

  // Gmail API 429
  if (status === 429) return true;

  // gaxios: messageに含まれることが多い
  if (message.includes('user-rate limit exceeded')) return true;
  if (message.includes('rate limit')) return true;
  if (message.includes('quota exceeded')) return true;
  if (message.includes('resource_exhausted')) return true;

  // response.data.error.code
  if (isRecord(error)) {
    const response = isRecord(error.response) ? error.response : undefined;
    const data = response && isRecord(response.data) ? response.data : undefined;
    const err = data && isRecord(data.error) ? data.error : undefined;
    const code = err && typeof err.code === 'number' ? err.code : undefined;
    if (code === 429) return true;
  }

  return false;
}

function extractRetryAfterMs(error: unknown): number {
  // 1) Retry-After header (seconds)
  if (isRecord(error)) {
    const headers =
      (isRecord(error.headers) ? error.headers : undefined) ??
      (isRecord(error.response) && isRecord(error.response.headers) ? error.response.headers : undefined);

    if (headers && typeof headers['retry-after'] === 'string') {
      const secs = parseInt(headers['retry-after'], 10);
      if (Number.isFinite(secs) && secs > 0) {
        return secs * 1000;
      }
    }
  }

  // 2) Parse timestamp in message: "Retry after 2026-02-19T11:33:04.778Z"
  const messages: string[] = [];
  const info = toErrorInfo(error);
  if (info.message) messages.push(info.message);
  if (isRecord(error) && isRecord(error.response) && isRecord(error.response.data)) {
    const data = error.response.data;
    if (isRecord(data.error) && typeof data.error.message === 'string') {
      messages.push(data.error.message);
    }
  }

  for (const msg of messages) {
    const match = msg.match(/Retry after ([0-9TZ:.-]+)/i);
    if (!match) continue;
    const retryAfterDate = new Date(match[1]);
    if (!Number.isFinite(retryAfterDate.getTime())) continue;
    const delay = retryAfterDate.getTime() - Date.now();
    if (delay > 0) return delay;
  }

  // 3) Fallback: small fixed backoff
  return 15_000;
}

