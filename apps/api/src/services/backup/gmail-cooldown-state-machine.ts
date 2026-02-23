export type GmailCooldownMode = 'NORMAL' | 'COOLDOWN' | 'PROBE' | 'RAMP_UP';

export type GmailCooldownStateInput = {
  last429At: Date | null;
  lastRetryAfterMs: number | null;
  now: Date;
  retryAfterMsFromGmail: number;
};

export type GmailCooldownDecision = {
  mode: GmailCooldownMode;
  relockLevel: 0 | 1 | 2 | 3;
  effectiveRetryAfterMs: number;
  cooldownUntil: Date;
};

/**
 * 429再突入を避けるための状態機械。
 * Retry-Afterが短くても、再発時は待機時間を段階的に引き上げる。
 */
export class GmailCooldownStateMachine {
  private static readonly LEVEL_WINDOWS_MS = [15 * 60_000, 60 * 60_000, 180 * 60_000, 720 * 60_000] as const;
  private static readonly ESCALATE_WINDOW_MS = 30 * 60_000;

  private inferRelockLevel(lastRetryAfterMs: number | null): 0 | 1 | 2 | 3 {
    if (!lastRetryAfterMs || lastRetryAfterMs <= 0) return 0;
    const windows = GmailCooldownStateMachine.LEVEL_WINDOWS_MS;
    if (lastRetryAfterMs >= windows[3]) return 3;
    if (lastRetryAfterMs >= windows[2]) return 2;
    if (lastRetryAfterMs >= windows[1]) return 1;
    return 0;
  }

  nextCooldown(input: GmailCooldownStateInput): GmailCooldownDecision {
    const { last429At, lastRetryAfterMs, now, retryAfterMsFromGmail } = input;
    const currentLevel = this.inferRelockLevel(lastRetryAfterMs);
    const shouldEscalate =
      !!last429At && now.getTime() - last429At.getTime() <= GmailCooldownStateMachine.ESCALATE_WINDOW_MS;
    const relockLevel = (shouldEscalate ? Math.min(currentLevel + 1, 3) : 0) as 0 | 1 | 2 | 3;
    const targetRetryAfter = GmailCooldownStateMachine.LEVEL_WINDOWS_MS[relockLevel];
    const effectiveRetryAfterMs = Math.max(retryAfterMsFromGmail, targetRetryAfter);

    return {
      mode: 'COOLDOWN',
      relockLevel,
      effectiveRetryAfterMs,
      cooldownUntil: new Date(now.getTime() + effectiveRetryAfterMs),
    };
  }
}

