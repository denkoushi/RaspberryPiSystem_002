import { describe, expect, it } from 'vitest';
import { baselinePlacementAllowed, baselinePlacementNeedsClientIdentity } from './inspection-drawing-baseline-clients.js';

describe('baseline placement allowlist', () => {
  it.each([
    [undefined, undefined, false, false],
    [[], ['kiosk-a'], false, false],
    [['kiosk-a'], ['kiosk-b'], true, false],
    [['kiosk-a'], ['x', 'kiosk-a'], true, true],
    [['*'], undefined, false, true],
    [['kiosk-a', '*'], ['kiosk-b'], false, true]
  ] as const)('allowlist %j with %j: needs identity %s, allowed %s', (allowed, ids, needs, ok) => {
    expect(baselinePlacementNeedsClientIdentity(allowed)).toBe(needs);
    expect(baselinePlacementAllowed(allowed, ids)).toBe(ok);
  });
});
