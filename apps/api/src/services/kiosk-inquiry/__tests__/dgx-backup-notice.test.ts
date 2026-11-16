import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { DGX_BACKUP_NOTICE_ENABLED: true },
  config: vi.fn(), runtime: vi.fn(), fetch: vi.fn(), deliver: vi.fn(),
}));
vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../inference/inference-runtime.js', () => ({ getInferenceRuntime: mocks.runtime }));
vi.mock('../system-notice.service.js', () => ({ deliverSystemNotice: mocks.deliver }));

import { evaluateDgxBackupNotice } from '../dgx-backup-notice.js';

const now = new Date('2026-11-16T00:00:00Z');
const payload = { contractVersion: 1, lastResult: 'failed', recordedAt: now.toISOString() };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.DGX_BACKUP_NOTICE_ENABLED = true;
  mocks.runtime.mockReturnValue({ getAdminLocalLlmRuntimeConfig: mocks.config });
  mocks.config.mockReturnValue({ baseUrl: 'http://dgx.test/v1', sharedToken: 'business-test-token' });
  mocks.fetch.mockResolvedValue(Response.json(payload));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('DGX backup notice', () => {
  it.each([['failed', 'open'], ['success', 'recovered']] as const)('delivers %s as %s', async (lastResult, state) => {
    mocks.fetch.mockResolvedValue(Response.json({ ...payload, lastResult }));
    await evaluateDgxBackupNotice(now);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(new URL('http://dgx.test/system/backup-status'), {
      method: 'GET', headers: { 'X-LLM-Token': 'business-test-token' }, signal: expect.any(AbortSignal),
    });
    expect(mocks.deliver).toHaveBeenCalledExactlyOnceWith({
      key: 'dgx-backup:failed', title: 'DGX バックアップ', body: '夜間のバックアップが失敗しました。', state,
    }, now);
  });

  it('accepts a null recordedAt', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ ...payload, recordedAt: null }));
    await evaluateDgxBackupNotice(now);
    expect(mocks.deliver).toHaveBeenCalledOnce();
  });

  it.each([
    { ...payload, lastResult: 'unknown' }, { ...payload, contractVersion: 2 },
    { ...payload, lastResult: 'invalid' }, { ...payload, recordedAt: 'invalid' },
    { contractVersion: 1, lastResult: 'success' }, null, [],
  ])('preserves notice state for unknown or invalid payload %j', async (body) => {
    mocks.fetch.mockResolvedValue(Response.json(body));
    await evaluateDgxBackupNotice(now);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it.each([401, 404, 500])('preserves notice state for HTTP %i', async (status) => {
    mocks.fetch.mockResolvedValue(new Response('unavailable', { status }));
    await evaluateDgxBackupNotice(now);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it('leaves invalid JSON to the evaluator error handler without delivery', async () => {
    mocks.fetch.mockResolvedValue(new Response('{broken'));
    await expect(evaluateDgxBackupNotice(now)).rejects.toThrow();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'body'])('aborts a stalled %s after five seconds without delivery', async (phase) => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation((_url, init) => {
      const pending = () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return phase === 'fetch' ? pending() : Promise.resolve({ ok: true, json: pending });
    });
    const evaluation = evaluateDgxBackupNotice(now);
    const rejected = expect(evaluation).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(4999);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not resolve connection settings or fetch when disabled', async () => {
    mocks.env.DGX_BACKUP_NOTICE_ENABLED = false;
    await evaluateDgxBackupNotice(now);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it.each([{ sharedToken: 'test-token' }, { baseUrl: 'http://dgx.test' }])('skips incomplete connection settings %j', async (config) => {
    mocks.config.mockReturnValue(config);
    await evaluateDgxBackupNotice(now);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
