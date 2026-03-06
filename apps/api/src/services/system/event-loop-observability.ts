import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
let previousElu = performance.eventLoopUtilization();

const toMs = (nanoseconds: number): number => Math.round(nanoseconds / 1e6);

export const EVENT_LOOP_HEALTH_THRESHOLD = {
  warnP99Ms: 120,
  degradedP99Ms: 250,
  warnEluUtilization: 0.8,
  degradedEluUtilization: 0.95,
} as const;

export type EventLoopSnapshot = {
  elu: {
    utilization: number;
    activeMs: number;
    idleMs: number;
  };
  eventLoopDelayMs: {
    mean: number;
    max: number;
    p50: number;
    p90: number;
    p99: number;
  };
};

export function snapshotEventLoopObservability(): EventLoopSnapshot {
  const currentElu = performance.eventLoopUtilization();
  const deltaElu = performance.eventLoopUtilization(currentElu, previousElu);
  previousElu = currentElu;

  return {
    elu: {
      utilization: Math.round(deltaElu.utilization * 1000) / 1000,
      activeMs: Math.round(deltaElu.active / 1e6),
      idleMs: Math.round(deltaElu.idle / 1e6),
    },
    eventLoopDelayMs: {
      mean: toMs(eventLoopDelay.mean),
      max: toMs(eventLoopDelay.max),
      p50: toMs(eventLoopDelay.percentile(50)),
      p90: toMs(eventLoopDelay.percentile(90)),
      p99: toMs(eventLoopDelay.percentile(99)),
    },
  };
}

export function evaluateEventLoopHealth(snapshot: EventLoopSnapshot): {
  status: 'ok' | 'error';
  message?: string;
} {
  const sampleWindowMs = snapshot.elu.activeMs + snapshot.elu.idleMs;
  if (!Number.isFinite(sampleWindowMs) || sampleWindowMs < 1000) {
    return { status: 'ok', message: 'Event loop warmup window (insufficient sample)' };
  }

  const p99 = snapshot.eventLoopDelayMs.p99;
  const elu = snapshot.elu.utilization;
  if (!Number.isFinite(p99) || !Number.isFinite(elu)) {
    return { status: 'ok', message: 'Event loop sample is not finite yet' };
  }

  const isDegraded =
    p99 >= EVENT_LOOP_HEALTH_THRESHOLD.degradedP99Ms ||
    elu >= EVENT_LOOP_HEALTH_THRESHOLD.degradedEluUtilization;

  if (isDegraded) {
    return {
      status: 'error',
      message: `Event loop degraded: p99=${p99}ms, elu=${elu.toFixed(3)}`,
    };
  }

  const isWarn =
    p99 >= EVENT_LOOP_HEALTH_THRESHOLD.warnP99Ms ||
    elu >= EVENT_LOOP_HEALTH_THRESHOLD.warnEluUtilization;

  if (isWarn) {
    return {
      status: 'ok',
      message: `Event loop warning: p99=${p99}ms, elu=${elu.toFixed(3)}`,
    };
  }

  return { status: 'ok' };
}
