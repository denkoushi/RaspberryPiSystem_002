import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchedulerStartupCleanupError } from '../scheduler-errors.js';
import {
  startSchedulerRuntime,
  type AdvisoryLockClient,
  type SchedulerRuntime,
} from '../scheduler-leader.js';
import { createSchedulerRuntimeState } from '../scheduler-runtime-state.js';

type Listener = (...args: unknown[]) => void;

class FakeAdvisoryLockClient implements AdvisoryLockClient {
  connected = false;
  private lockHeld = false;
  private readonly listeners = new Map<'error' | 'end', Set<Listener>>();

  constructor(private readonly server: SharedAdvisoryLockServer) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query(
    queryText: string,
    _values?: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>> }> {
    if (!this.connected) throw new Error('FakeAdvisoryLockClient is not connected');
    const normalized = queryText.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes('pg_try_advisory_lock')) {
      const acquired = this.server.tryAcquire(this);
      this.lockHeld = acquired;
      return { rows: [{ acquired }] };
    }

    if (normalized.includes('pg_advisory_unlock')) {
      this.server.release(this);
      this.lockHeld = false;
      return { rows: [{ released: true }] };
    }

    if (normalized.includes('pg_locks') || normalized.includes(' as held')) {
      return { rows: [{ held: this.lockHeld && this.server.isHolder(this) }] };
    }

    throw new Error(`Unexpected SQL in SharedAdvisoryLockServer fake: ${queryText}`);
  }

  async end(): Promise<void> {
    if (this.lockHeld) {
      this.server.release(this);
      this.lockHeld = false;
    }
    this.connected = false;
    this.emit('end');
  }

  on(event: 'error' | 'end', listener: Listener): this {
    const bucket = this.listeners.get(event) ?? new Set<Listener>();
    bucket.add(listener);
    this.listeners.set(event, bucket);
    return this;
  }

  removeListener(event: 'error' | 'end', listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  loseAdvisoryLock(): void {
    this.server.forceLose(this);
    this.lockHeld = false;
  }

  emitError(error: Error): void {
    this.emit('error', error);
  }

  private emit(event: 'error' | 'end', ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

/** In-memory stand-in for a shared PostgreSQL advisory-lock namespace. */
class SharedAdvisoryLockServer {
  readonly clients: FakeAdvisoryLockClient[] = [];
  private holder: FakeAdvisoryLockClient | null = null;

  createClient(): FakeAdvisoryLockClient {
    const client = new FakeAdvisoryLockClient(this);
    this.clients.push(client);
    return client;
  }

  tryAcquire(client: FakeAdvisoryLockClient): boolean {
    if (this.holder && this.holder !== client) return false;
    this.holder = client;
    return true;
  }

  release(client: FakeAdvisoryLockClient): void {
    if (this.holder === client) this.holder = null;
  }

  forceLose(client: FakeAdvisoryLockClient): void {
    if (this.holder === client) this.holder = null;
  }

  isHolder(client: FakeAdvisoryLockClient): boolean {
    return this.holder === client;
  }
}

function schedulerGroupSpies() {
  return {
    start: vi.fn(async () => ({ marker: 'handles' })),
    stop: vi.fn(async () => undefined),
  };
}

describe('scheduler leader advisory lock', () => {
  const runtimes: SchedulerRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      const runtime = runtimes.pop();
      if (runtime) await runtime.stop().catch(() => undefined);
    }
    vi.clearAllMocks();
  });

  it('elects a single leader and hands off after the owner releases the lock', async () => {
    const server = new SharedAdvisoryLockServer();
    const group = schedulerGroupSpies();

    const first = await startSchedulerRuntime({} as never, {
      enabled: true,
      databaseUrl: 'postgresql://scheduler-test/single-leader',
      state: createSchedulerRuntimeState(),
      clientFactory: () => server.createClient(),
      startSchedulers: group.start,
      stopSchedulers: group.stop,
      retryInitialMs: 1_000,
      retryMaxMs: 1_000,
      standbyRetryMs: 5,
      probeIntervalMs: 50,
    });
    runtimes.push(first);

    await vi.waitFor(() => expect(group.start).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });
    expect(first.getStatus()).toMatchObject({
      enabled: true,
      role: 'leader',
      databaseConnection: 'connected',
    });

    const second = await startSchedulerRuntime({} as never, {
      enabled: true,
      databaseUrl: 'postgresql://scheduler-test/single-leader',
      state: createSchedulerRuntimeState(),
      clientFactory: () => server.createClient(),
      startSchedulers: group.start,
      stopSchedulers: group.stop,
      retryInitialMs: 1_000,
      retryMaxMs: 1_000,
      standbyRetryMs: 5,
      probeIntervalMs: 50,
    });
    runtimes.push(second);

    await vi.waitFor(() => expect(second.getStatus().role).toBe('standby'), {
      timeout: 1_000,
      interval: 10,
    });
    expect(group.start).toHaveBeenCalledTimes(1);
    expect(server.clients[1]?.connected).toBe(true);

    await first.stop();

    await vi.waitFor(() => expect(group.start).toHaveBeenCalledTimes(2), {
      timeout: 1_000,
      interval: 10,
    });
    expect(second.getStatus()).toMatchObject({
      role: 'leader',
      databaseConnection: 'connected',
    });
  });

  it('fails closed without reconnecting when stop fails after connection loss', async () => {
    const server = new SharedAdvisoryLockServer();
    const group = schedulerGroupSpies();
    group.stop.mockRejectedValueOnce(new Error('scheduler group could not stop after connection loss'));
    const fatalShutdown = vi.fn(async () => undefined);

    const runtime = await startSchedulerRuntime({} as never, {
      enabled: true,
      databaseUrl: 'postgresql://scheduler-test/connection-loss-stop-failure',
      state: createSchedulerRuntimeState(),
      clientFactory: () => server.createClient(),
      startSchedulers: group.start,
      stopSchedulers: group.stop,
      retryInitialMs: 1,
      retryMaxMs: 1,
      standbyRetryMs: 1,
      probeIntervalMs: 50,
      fatalShutdown,
    });
    runtimes.push(runtime);

    await vi.waitFor(() => expect(group.start).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });

    server.clients[0]?.emitError(new Error('connection terminated unexpectedly'));

    await vi.waitFor(() => expect(fatalShutdown).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(group.start).toHaveBeenCalledTimes(1);
    expect(server.clients).toHaveLength(1);
    expect(runtime.getStatus()).toMatchObject({
      enabled: true,
      role: 'stopped',
      databaseConnection: 'disconnected',
    });
  });

  it('fails closed and keeps the advisory lock when startup cleanup is ambiguous', async () => {
    const server = new SharedAdvisoryLockServer();
    const group = schedulerGroupSpies();
    group.start.mockRejectedValueOnce(
      new SchedulerStartupCleanupError([
        new Error('start failed'),
        new Error('cleanup also failed'),
      ])
    );
    const fatalShutdown = vi.fn(async () => undefined);

    const runtime = await startSchedulerRuntime({} as never, {
      enabled: true,
      databaseUrl: 'postgresql://scheduler-test/startup-cleanup-ambiguous',
      state: createSchedulerRuntimeState(),
      clientFactory: () => server.createClient(),
      startSchedulers: group.start,
      stopSchedulers: group.stop,
      retryInitialMs: 1,
      retryMaxMs: 1,
      standbyRetryMs: 1,
      probeIntervalMs: 50,
      fatalShutdown,
    });
    runtimes.push(runtime);

    await vi.waitFor(() => expect(fatalShutdown).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(group.start).toHaveBeenCalledTimes(1);
    expect(server.clients).toHaveLength(1);
    expect(server.isHolder(server.clients[0]!)).toBe(true);
    expect(runtime.getStatus()).toMatchObject({
      enabled: true,
      role: 'stopped',
      databaseConnection: 'disconnected',
    });
  });

  it('stops the job group when the dedicated session no longer holds the advisory lock', async () => {
    const server = new SharedAdvisoryLockServer();
    const group = schedulerGroupSpies();
    const runtime = await startSchedulerRuntime({} as never, {
      enabled: true,
      databaseUrl: 'postgresql://scheduler-test/lock-loss',
      state: createSchedulerRuntimeState(),
      clientFactory: () => server.createClient(),
      startSchedulers: group.start,
      stopSchedulers: group.stop,
      retryInitialMs: 1_000,
      retryMaxMs: 1_000,
      standbyRetryMs: 5,
      probeIntervalMs: 5,
    });
    runtimes.push(runtime);

    await vi.waitFor(() => expect(group.start).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });

    server.clients[0]?.loseAdvisoryLock();

    await vi.waitFor(() => expect(group.stop).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });
    expect(runtime.getStatus()).toMatchObject({
      role: 'standby',
      databaseConnection: 'disconnected',
    });
  });

  it('fails closed without reconnecting when stop fails after advisory-lock probe loss', async () => {
    const server = new SharedAdvisoryLockServer();
    const group = schedulerGroupSpies();
    group.stop.mockRejectedValueOnce(new Error('scheduler group could not stop after probe'));
    const fatalShutdown = vi.fn(async () => undefined);

    const runtime = await startSchedulerRuntime({} as never, {
      enabled: true,
      databaseUrl: 'postgresql://scheduler-test/probe-stop-failure',
      state: createSchedulerRuntimeState(),
      clientFactory: () => server.createClient(),
      startSchedulers: group.start,
      stopSchedulers: group.stop,
      retryInitialMs: 1,
      retryMaxMs: 1,
      standbyRetryMs: 1,
      probeIntervalMs: 5,
      fatalShutdown,
    });
    runtimes.push(runtime);

    await vi.waitFor(() => expect(group.start).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });

    server.clients[0]?.loseAdvisoryLock();

    await vi.waitFor(() => expect(fatalShutdown).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(group.start).toHaveBeenCalledTimes(1);
    expect(server.clients).toHaveLength(1);
    expect(runtime.getStatus()).toMatchObject({
      enabled: true,
      role: 'stopped',
      databaseConnection: 'disconnected',
    });
  });

  it('fails closed when runtime shutdown cannot prove scheduler-group stop', async () => {
    const server = new SharedAdvisoryLockServer();
    const group = schedulerGroupSpies();
    const fatalShutdown = vi.fn(async () => undefined);
    const runtime = await startSchedulerRuntime({} as never, {
      enabled: true,
      databaseUrl: 'postgresql://scheduler-test/runtime-stop-failure',
      state: createSchedulerRuntimeState(),
      clientFactory: () => server.createClient(),
      startSchedulers: group.start,
      stopSchedulers: group.stop,
      retryInitialMs: 1,
      retryMaxMs: 1,
      standbyRetryMs: 1,
      probeIntervalMs: 5,
      fatalShutdown,
    });
    runtimes.push(runtime);

    await vi.waitFor(() => expect(group.start).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });
    group.stop.mockRejectedValueOnce(new Error('scheduler group could not stop on shutdown'));

    await runtime.stop();

    expect(fatalShutdown).toHaveBeenCalledTimes(1);
    expect(runtime.getStatus()).toMatchObject({
      enabled: true,
      role: 'stopped',
      databaseConnection: 'disconnected',
    });
  });

  it('retains legacy direct scheduler startup when leader election is disabled', async () => {
    const group = schedulerGroupSpies();
    const state = createSchedulerRuntimeState();
    const runtime = await startSchedulerRuntime({} as never, {
      enabled: false,
      state,
      startSchedulers: group.start,
      stopSchedulers: group.stop,
    });
    runtimes.push(runtime);

    expect(group.start).toHaveBeenCalledTimes(1);
    expect(runtime.getStatus()).toMatchObject({ enabled: false, role: 'leader' });
    await runtime.stop();
    expect(group.stop).toHaveBeenCalledTimes(1);
    expect(runtime.getStatus()).toMatchObject({ enabled: false, role: 'stopped' });
  });
});
