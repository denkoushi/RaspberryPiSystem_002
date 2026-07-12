import { describe, expect, it, vi } from 'vitest';
import { createDeployReadinessObservability } from '../deploy-readiness-observability.js';

describe('deploy-readiness-observability', () => {
  it('tracks rolling-window sample and server-error rates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));

    const metrics = createDeployReadinessObservability(60);
    expect(metrics.snapshot()).toEqual({
      windowSeconds: 60,
      sampleCount: 0,
      serverErrorCount: 0,
      errorRate: 0,
    });

    metrics.recordResponse(200);
    metrics.recordResponse(503);
    metrics.recordResponse(500);

    expect(metrics.snapshot()).toEqual({
      windowSeconds: 60,
      sampleCount: 3,
      serverErrorCount: 2,
      errorRate: 2 / 3,
    });

    vi.setSystemTime(new Date('2026-07-12T00:01:01.000Z'));
    expect(metrics.snapshot()).toEqual({
      windowSeconds: 60,
      sampleCount: 0,
      serverErrorCount: 0,
      errorRate: 0,
    });

    vi.useRealTimers();
  });
});
