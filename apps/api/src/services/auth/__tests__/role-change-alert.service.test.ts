import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleChangeAlertService } from '../role-change-alert.service.js';

const ENV_KEYS = ['ALERT_WEBHOOK_URL', 'ALERT_WEBHOOK_TIMEOUT_MS', 'ALERTS_DIR'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makePorts() {
  const fileSystem = {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined)
  };
  const fetchPort = vi.fn(async () => new Response('ok'));
  const logger = { warn: vi.fn() };
  return { fileSystem, fetchPort, logger };
}

const baseInput = {
  actorUserId: 'actor-1',
  actorUsername: 'admin',
  targetUserId: 'target-1',
  targetUsername: 'bob',
  fromRole: 'VIEWER' as const,
  toRole: 'ADMIN' as const,
  reasons: ['promotion-to-admin']
};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.ALERTS_DIR = '/var/alerts-test';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-01T03:04:05.000Z'));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.useRealTimers();
});

function parseWrittenAlert(fileSystem: ReturnType<typeof makePorts>['fileSystem']) {
  const call = fileSystem.writeFile.mock.calls[0] as unknown as [string, string, string];
  return { filePath: call[0], alert: JSON.parse(call[1]), encoding: call[2] };
}

describe('RoleChangeAlertService.emitRoleChangeAlert', () => {
  it('writes a warning alert file describing the role change', async () => {
    const { fileSystem, fetchPort, logger } = makePorts();
    const service = new RoleChangeAlertService(fileSystem as never, fetchPort as never);
    await service.emitRoleChangeAlert({ ...baseInput, logger });

    expect(fileSystem.mkdir).toHaveBeenCalledWith('/var/alerts-test', { recursive: true });
    const { filePath, alert, encoding } = parseWrittenAlert(fileSystem);
    expect(encoding).toBe('utf-8');
    expect(filePath).toBe(path.join('/var/alerts-test', `alert-${alert.id}.json`));
    expect(alert).toMatchObject({
      type: 'role_change',
      severity: 'warning',
      message: '権限変更: bob を VIEWER から ADMIN に変更 (by admin)',
      reasons: ['promotion-to-admin'],
      details: {
        actorUserId: 'actor-1',
        actorUsername: 'admin',
        targetUserId: 'target-1',
        targetUsername: 'bob',
        fromRole: 'VIEWER',
        toRole: 'ADMIN'
      },
      timestamp: '2026-04-01T03:04:05.000Z',
      acknowledged: false
    });
    expect(alert.id).toMatch(/^[0-9a-f-]{36}$/);
    // No webhook configured -> no network call.
    expect(fetchPort).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the actor id in the message when the username is unknown', async () => {
    const { fileSystem, fetchPort, logger } = makePorts();
    const service = new RoleChangeAlertService(fileSystem as never, fetchPort as never);
    await service.emitRoleChangeAlert({ ...baseInput, actorUsername: undefined, logger });
    expect(parseWrittenAlert(fileSystem).alert.message).toBe('権限変更: bob を VIEWER から ADMIN に変更 (by actor-1)');
  });

  it('posts the same alert JSON to the webhook when configured', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    const { fileSystem, fetchPort, logger } = makePorts();
    const service = new RoleChangeAlertService(fileSystem as never, fetchPort as never);
    await service.emitRoleChangeAlert({ ...baseInput, logger });

    expect(fetchPort).toHaveBeenCalledTimes(1);
    const [url, init] = fetchPort.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://alerts.example.test/hook');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(parseWrittenAlert(fileSystem).alert);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it('still sends the webhook and only logs when writing the file fails', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    const { fileSystem, fetchPort, logger } = makePorts();
    fileSystem.mkdir.mockRejectedValue(new Error('EACCES'));
    const service = new RoleChangeAlertService(fileSystem as never, fetchPort as never);

    await expect(service.emitRoleChangeAlert({ ...baseInput, logger })).resolves.toBeUndefined();
    expect(fileSystem.writeFile).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Failed to write role change alert');
    expect(fetchPort).toHaveBeenCalledTimes(1);
  });

  it('swallows webhook errors and logs them', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    const { fileSystem, fetchPort, logger } = makePorts();
    fetchPort.mockRejectedValue(new Error('network down'));
    const service = new RoleChangeAlertService(fileSystem as never, fetchPort as never);

    await expect(service.emitRoleChangeAlert({ ...baseInput, logger })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Failed to send role change alert webhook');
  });

  it('aborts a hanging webhook after ALERT_WEBHOOK_TIMEOUT_MS', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    process.env.ALERT_WEBHOOK_TIMEOUT_MS = '1500';
    const { fileSystem, logger } = makePorts();
    let capturedSignal: AbortSignal | undefined;
    const hangingFetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          capturedSignal = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const service = new RoleChangeAlertService(fileSystem as never, hangingFetch as never);

    const pending = service.emitRoleChangeAlert({ ...baseInput, logger });
    await vi.advanceTimersByTimeAsync(1499);
    expect(capturedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(capturedSignal?.aborted).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), 'Failed to send role change alert webhook');
  });

  it('clears the timeout once the webhook completes', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    const { fileSystem, fetchPort, logger } = makePorts();
    const service = new RoleChangeAlertService(fileSystem as never, fetchPort as never);
    await service.emitRoleChangeAlert({ ...baseInput, logger });
    expect(vi.getTimerCount()).toBe(0);
  });
});
