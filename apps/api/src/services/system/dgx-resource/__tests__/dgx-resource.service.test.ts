import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../tools/photo-tool-label/photo-tool-embedding-health.js', () => ({ readPhotoToolEmbeddingHealth: vi.fn() }));

import { env } from '../../../../config/env.js';
import { getBusinessProfileIntentStore } from '../../../inference/config/business-profile-intent-store.js';
import { readPhotoToolEmbeddingHealth } from '../../../tools/photo-tool-label/photo-tool-embedding-health.js';
import { DgxResourceStateStore } from '../dgx-resource.state-store.js';
import { createDgxResourceService } from '../dgx-resource.service.js';

function setup() {
  const stateStore = new DgxResourceStateStore(50);
  const profile = {
    id: 'model-a', displayNameJa: '業務モデル A', backend: 'blue', servedAlias: 'business',
    enabled: true, status: 'available', businessOrchestrationEligible: true, recommended: true,
    runtimeProfile: { engine: 'vllm', vllm: { gpuMemoryUtilization: 0.5 } },
    deleteProtection: { canDelete: true, protected: false, reasons: [] },
  };
  const upstream = {
    profiles: [profile], activeProfileId: 'model-a' as string | null, state: { backend: 'blue' },
  };
  const status = { configured: true, timeoutMs: 1000, health: { ok: true } };
  let modelsOk = true;
  let startOk = true;
  let metrics = { unifiedMemoryUsedGiB: 32, unifiedMemoryTotalGiB: 128, startupFreeMemoryGiB: 80, gpuUtilPct: 23, gpuTemperatureC: 45, gpuPowerDrawW: 60 };
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/start')) return new Response('', { status: startOk ? 200 : 500 });
    if (url.endsWith('/stop-force')) return new Response('');
    if (url.endsWith('/system/model-profiles')) return Response.json(upstream);
    if (url.endsWith('/v1/models')) return Response.json({ data: [] }, { status: modelsOk ? 200 : 503 });
    if (url.endsWith('/system/metrics')) return Response.json(metrics);
    if (url.endsWith('/model-storage-delete/preview')) return Response.json({
      ok: true, modelProfileId: 'model-a', displayNameJa: '業務モデル A', canDelete: true,
      blockedReasons: [], storagePath: '/models/a', resolvedStoragePath: '/models/a',
      requiredConfirmation: 'DELETE model-a', planFingerprint: 'f'.repeat(64),
    });
    if (url.endsWith('/model-storage-delete/execute')) return Response.json({ ok: true, ...JSON.parse(String(init?.body)) });
    return new Response('', { status: 404 });
  });
  const deps = {
    fetchImpl, stateStore, probeTimeoutMs: 1000,
    localLlmGateway: { getStatus: vi.fn(async () => status), createChatCompletion: vi.fn() },
    getAdminLocalLlmRuntimeConfig: () => ({ configured: true, baseUrl: 'http://dgx.test', sharedToken: 'test-token', timeoutMs: 1000 }),
  };
  return {
    svc: createDgxResourceService(deps), deps, stateStore, profile, upstream, status, fetchImpl,
    setModelsOk: (value: boolean) => { modelsOk = value; }, setStartOk: (value: boolean) => { startOk = value; },
    setFreeMemory: (value: number) => { metrics = { ...metrics, startupFreeMemoryGiB: value }; },
  };
}

const original = {
  LOCAL_LLM_RUNTIME_MODE: env.LOCAL_LLM_RUNTIME_MODE,
  LOCAL_LLM_RUNTIME_CONTROL_START_URL: env.LOCAL_LLM_RUNTIME_CONTROL_START_URL,
  LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL,
  LOCAL_LLM_RUNTIME_CONTROL_TOKEN: env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN,
  LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS: env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS,
  LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS: env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS,
  INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID: env.INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID,
  INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH: env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH,
};
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(env, {
    LOCAL_LLM_RUNTIME_MODE: 'on_demand',
    LOCAL_LLM_RUNTIME_CONTROL_START_URL: 'http://dgx.test/start',
    LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: 'http://dgx.test/stop',
    LOCAL_LLM_RUNTIME_CONTROL_TOKEN: 'test-token',
    LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS: 100,
    LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS: 10,
    INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID: undefined,
    INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH: undefined,
  });
  getBusinessProfileIntentStore().clearForTests();
  vi.mocked(readPhotoToolEmbeddingHealth).mockReturnValue({ state: 'not_observed', lastSuccessAt: null, lastFailureAt: null, lastErrorBrief: null });
});
afterEach(() => {
  Object.assign(env, original);
  getBusinessProfileIntentStore().clearForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('business overview', () => {
  it.each(['not_observed', 'disabled', 'ok'] as const)('is ready with embedding %s', async (state) => {
    vi.mocked(readPhotoToolEmbeddingHealth).mockReturnValue({ state, lastSuccessAt: null, lastFailureAt: null, lastErrorBrief: null });
    const { svc } = setup();
    const overview = await svc.getOverview();
    expect(overview.business.state).toBe('ready');
    expect(overview.business.matchesIntent).toBeNull();
    expect(overview.metrics).toEqual({ unifiedMemUsedBytes: 32 * 1024 ** 3, unifiedMemTotalBytes: 128 * 1024 ** 3, gpuUtilPct: 23, temperatureC: 45, powerW: 60 });
  });
  it('reports mismatch without replacing the intended model', async () => {
    getBusinessProfileIntentStore().setFromOrchestration('model-b');
    const overview = await setup().svc.getOverview();
    expect(overview.business).toMatchObject({ state: 'ready_mismatch', matchesIntent: false, intendedProfile: { id: 'model-b' }, activeProfile: { id: 'model-a' } });
    expect(getBusinessProfileIntentStore().getModelProfileId()).toBe('model-b');
    expect(overview.alerts[0]?.messageJa).toContain('違います');
    expect(JSON.stringify(overview.alerts)).not.toContain('model-b');
  });
  it('matches the configured business intent without changing resolver precedence', async () => {
    getBusinessProfileIntentStore().setFromOrchestration('model-b');
    env.INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID = 'model-a';
    expect((await setup().svc.getOverview()).business).toMatchObject({ state: 'ready', matchesIntent: true });
  });
  it('degrades on embedding failure ahead of model mismatch', async () => {
    getBusinessProfileIntentStore().setFromOrchestration('model-b');
    vi.mocked(readPhotoToolEmbeddingHealth).mockReturnValue({ state: 'failed', lastSuccessAt: null, lastFailureAt: new Date().toISOString(), lastErrorBrief: '処理に失敗しました' });
    expect((await setup().svc.getOverview()).business.state).toBe('degraded');
  });
  it.each(['gateway', 'models'] as const)('is down if %s does not respond', async (probe) => {
    const test = setup();
    if (probe === 'gateway') test.status.health.ok = false;
    else test.setModelsOk(false);
    expect((await test.svc.getOverview()).business.state).toBe('down');
  });
  it('is unconfigured when no gateway is configured', async () => {
    const test = setup(); test.status.configured = false;
    expect((await test.svc.getOverview()).business.state).toBe('unconfigured');
  });
  it('prioritizes returning even when the LLM is unconfigured', async () => {
    const test = setup(); test.status.configured = false; test.stateStore.startReturn('model-a');
    expect((await test.svc.getOverview()).business.state).toBe('returning');
  });
  it('hides non-business profiles and never probes auxiliary workloads', async () => {
    const test = setup();
    test.upstream.profiles.push({ ...test.profile, id: 'personal-model', businessOrchestrationEligible: false });
    const overview = await test.svc.getOverview();
    expect(overview.modelProfiles.map((p) => p.id)).toEqual(['model-a']);
    expect(test.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      'http://dgx.test/system/model-profiles', 'http://dgx.test/v1/models', 'http://dgx.test/system/metrics',
    ]));
    expect(test.fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('returns null metrics and unavailable model list on failed optional reads', async () => {
    const test = setup(); test.fetchImpl.mockResolvedValue(new Response('', { status: 503 }));
    const overview = await test.svc.getOverview();
    expect(overview.modelProfilesAvailable).toBe(false);
    expect(Object.values(overview.metrics)).toEqual([null, null, null, null, null]);
  });
});

describe('business actions', () => {
  it('returns in progress immediately, then records intent only after stable readiness', async () => {
    const test = setup();
    const result = await test.svc.executeAction({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'model-a' });
    expect(result.businessReturn?.state).toBe('in_progress');
    expect(getBusinessProfileIntentStore().get()).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(test.stateStore.getBusinessReturn()).toMatchObject({ state: 'succeeded', profileId: 'model-a', failureReasonJa: null });
    expect(getBusinessProfileIntentStore().get()).toMatchObject({ modelProfileId: 'model-a', source: 'orchestration' });
    const posts = test.fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(String(posts[0]?.[0])).toBe('http://dgx.test/start');
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({ modelProfileId: 'model-a' });
    expect(test.svc.getEvents(8)[0]?.message).toBe('「業務モデル A」で業務に戻しました。');
  });
  it('shares running state between service instances and rejects duplicate requests before validation', async () => {
    const test = setup();
    const first = test.svc.executeAction({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'model-a' });
    const second = createDgxResourceService(test.deps);
    await expect(second.executeAction({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'model-a' })).rejects.toMatchObject({ statusCode: 409 });
    await first;
    expect((await second.getOverview()).businessReturn.state).toBe('in_progress');
    await expect(second.executeAction({ type: 'STOP_BUSINESS_LLM' })).rejects.toMatchObject({ statusCode: 409 });
    await vi.advanceTimersByTimeAsync(20);
  });
  it('records a safe failure and preserves prior intent when start fails', async () => {
    const test = setup(); test.setStartOk(false);
    getBusinessProfileIntentStore().setFromOrchestration('model-b');
    await test.svc.executeAction({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'model-a' });
    await vi.advanceTimersByTimeAsync(1);
    expect(test.stateStore.getBusinessReturn().state).toBe('failed');
    expect(getBusinessProfileIntentStore().getModelProfileId()).toBe('model-b');
    expect((await test.svc.getOverview()).alerts.some((alert) => alert.id === 'return_failed')).toBe(true);
    expect(test.stateStore.getBusinessReturn().failureReasonJa).not.toMatch(/http|token|500|start/);
  });
  it('retries start exactly once and times out if the active model never matches', async () => {
    const test = setup(); test.upstream.activeProfileId = 'different';
    await test.svc.executeAction({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'model-a' });
    await vi.advanceTimersByTimeAsync(120);
    expect(test.stateStore.getBusinessReturn().state).toBe('failed');
    expect(test.stateStore.getBusinessReturn().failureReasonJa).toContain('時間内');
    expect(getBusinessProfileIntentStore().get()).toBeNull();
    expect(test.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/start'))).toHaveLength(2);
    await expect(test.svc.executeAction({ type: 'STOP_BUSINESS_LLM' })).resolves.toMatchObject({ ok: true });
  });
  it.each(['missing', 'disabled', 'unavailable', 'personal', 'memory'] as const)('rejects a non-startable profile: %s', async (reason) => {
    const test = setup();
    if (reason === 'disabled') test.profile.enabled = false;
    if (reason === 'unavailable') test.profile.status = 'unavailable';
    if (reason === 'personal') test.profile.businessOrchestrationEligible = false;
    if (reason === 'memory') test.setFreeMemory(1);
    await expect(test.svc.executeAction({ type: 'RETURN_TO_BUSINESS', modelProfileId: reason === 'missing' ? 'unknown' : 'model-a' })).rejects.toMatchObject({ statusCode: reason === 'missing' ? 400 : 409 });
    expect(test.fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(test.stateStore.getBusinessReturn().state).toBe('idle');
  });
  it('stops only the business gateway with stop-force', async () => {
    const test = setup();
    await test.svc.executeAction({ type: 'STOP_BUSINESS_LLM' });
    expect(test.fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(test.fetchImpl.mock.calls[0]?.[0])).toBe('http://dgx.test/stop-force');
    expect(test.svc.getEvents(8)[0]?.message).toBe('業務 LLM を止めました。');
  });
  it('logs stop failures without raw upstream errors', async () => {
    const test = setup(); test.fetchImpl.mockRejectedValue(new Error('https://secret.test?token=secret'));
    await expect(test.svc.executeAction({ type: 'STOP_BUSINESS_LLM' })).rejects.toThrow();
    expect(test.svc.getEvents(8)[0]?.message).toBe('業務 LLM を止められませんでした。');
  });
  it('preserves the storage deletion preview and execute contract', async () => {
    const test = setup();
    const preview = await test.svc.executeAction({ type: 'PREVIEW_MODEL_STORAGE_DELETE', modelProfileId: 'model-a' });
    expect(preview.modelStorageDeletePreview?.requiredConfirmation).toBe('DELETE model-a');
    await test.svc.executeAction({ type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: 'model-a', planFingerprint: 'f'.repeat(64), confirmation: 'DELETE model-a' });
    const call = test.fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/execute'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ modelProfileId: 'model-a', planFingerprint: 'f'.repeat(64), confirmation: 'DELETE model-a' });
    expect(test.svc.getEvents(8)[0]?.message).toBe('「業務モデル A」の保存先を削除しました。');
  });
});
