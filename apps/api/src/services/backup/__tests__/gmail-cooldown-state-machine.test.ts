import { describe, expect, it } from 'vitest';
import { GmailCooldownStateMachine } from '../gmail-cooldown-state-machine.js';

describe('GmailCooldownStateMachine', () => {
  it('uses initial 15m cooldown at first 429', () => {
    const machine = new GmailCooldownStateMachine();
    const now = new Date('2026-02-19T12:00:00.000Z');
    const decision = machine.nextCooldown({
      now,
      last429At: null,
      lastRetryAfterMs: null,
      retryAfterMsFromGmail: 30_000,
    });

    expect(decision.relockLevel).toBe(0);
    expect(decision.effectiveRetryAfterMs).toBe(15 * 60_000);
  });

  it('escalates cooldown when 429 repeats in short window', () => {
    const machine = new GmailCooldownStateMachine();
    const now = new Date('2026-02-19T12:10:00.000Z');
    const decision = machine.nextCooldown({
      now,
      last429At: new Date('2026-02-19T11:55:00.000Z'),
      lastRetryAfterMs: 15 * 60_000,
      retryAfterMsFromGmail: 30_000,
    });

    expect(decision.relockLevel).toBe(1);
    expect(decision.effectiveRetryAfterMs).toBe(60 * 60_000);
  });
});

