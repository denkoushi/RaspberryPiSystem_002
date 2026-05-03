import { describe, expect, it, vi } from 'vitest';

import { env } from '../../../../config/env.js';
import { ApiError } from '../../../../lib/errors.js';
import { DgxResourcePolicyStore } from '../dgx-resource.policy-store.js';
import { createDgxResourceService } from '../dgx-resource.service.js';

import type { LocalLlmGateway } from '../../local-llm-proxy.service.js';

const defaultTestFetch = (async (): Promise<Response> =>
  ({
    ok: false,
    status: 599,
    text: async () => '',
    json: async () => ({}),
    headers: new Headers(),
    url: '',
  }) as Response) as typeof fetch;

function makeSvc(
  store: DgxResourcePolicyStore,
  gateway: LocalLlmGateway,
  opts?: {
    fetchImpl?: typeof fetch;
    sparkHostStatusUrl?: string;
    comfyHealthUrl?: string;
  }
) {
  return createDgxResourceService({
    fetchImpl: opts?.fetchImpl ?? defaultTestFetch,
    localLlmGateway: gateway,
    getAdminLocalLlmRuntimeConfig: () => ({
      configured: true,
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      model: 'm1',
      timeoutMs: 60_000,
    }),
    policyStore: store,
    probeTimeoutMs: 3000,
    ...(opts?.sparkHostStatusUrl ? { sparkHostStatusUrl: opts.sparkHostStatusUrl } : {}),
    ...(opts?.comfyHealthUrl ? { comfyHealthUrl: opts.comfyHealthUrl } : {}),
  });
}

describe('createDgxResourceService', () => {
  it('SET_POLICY persists in store and logs event', async () => {
    const store = new DgxResourcePolicyStore(20);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: true,
        baseUrl: 'http://127.0.0.1:38081',
        model: 'm1',
        timeoutMs: 60_000,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await svc.executeAction({ type: 'SET_POLICY', policyMode: 'private_ok' });
    const overview = await svc.getOverview();

    expect(overview.policy.mode).toBe('private_ok');
    expect(svc.getEvents(5)[0]?.message).toContain('変更');
  });

  it('SET_POLICY experiment_first updates KPI label and exposes previous mode', async () => {
    const store = new DgxResourcePolicyStore(20);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await svc.executeAction({ type: 'SET_POLICY', policyMode: 'private_ok' });
    let ov = await svc.getOverview();
    expect(ov.policy.previousMode).toBe('business_first');
    expect(ov.kpis.policyMode).toBe('private_ok');

    await svc.executeAction({ type: 'SET_POLICY', policyMode: 'experiment_first' });
    ov = await svc.getOverview();
    expect(ov.policy.mode).toBe('experiment_first');
    expect(ov.policy.previousMode).toBe('private_ok');
    expect(ov.kpis.policyLabel).toBe('実験優先');
  });

  it('SET_POLICY same mode does not append duplicate event or rewrite previous mode', async () => {
    const store = new DgxResourcePolicyStore(20);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await svc.executeAction({ type: 'SET_POLICY', policyMode: 'private_ok' });
    const firstEvents = svc.getEvents(10);
    expect(firstEvents).toHaveLength(1);

    const res = await svc.executeAction({ type: 'SET_POLICY', policyMode: 'private_ok' });
    const ov = await svc.getOverview();

    expect(res.message).toBe('私用OKモードのままです');
    expect(ov.policy.previousMode).toBe('business_first');
    expect(svc.getEvents(10)).toHaveLength(1);
  });

  it('sparkHost reflects GET probe when URL configured', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const u = typeof input === 'string' ? input : (input as URL).href;
      if (u.endsWith('/spark-health')) {
        return { ok: true, status: 200, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
      }
      return { ok: false, status: 404, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
    });

    const svc = makeSvc(store, gateway, {
      sparkHostStatusUrl: 'http://127.0.0.1:9999/spark-health',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const ov = await svc.getOverview();
    expect(ov.optionalProbes.sparkHostConfigured).toBe(true);
    expect(ov.sparkHost.configured).toBe(true);
    expect(ov.sparkHost.status).toBe('running');
    expect(ov.sparkHost.httpStatus).toBe(200);
  });

  it('sparkHost falls back to admin /healthz when explicit URL is absent', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: true,
        baseUrl: 'http://127.0.0.1:38081',
        model: 'm1',
        timeoutMs: 60_000,
        health: { ok: true, statusCode: 200 },
      })),
      createChatCompletion: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const u = typeof input === 'string' ? input : (input as URL).href;
      if (u === 'http://127.0.0.1:38081/v1/models' || u === 'http://127.0.0.1:38081/healthz') {
        return { ok: true, status: 200, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
      }
      return { ok: false, status: 404, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
    });

    const svc = makeSvc(store, gateway, {
      fetchImpl: fetchImpl as typeof fetch,
    });

    const ov = await svc.getOverview();
    expect(ov.optionalProbes.sparkHostConfigured).toBe(true);
    expect(ov.sparkHost.status).toBe('running');
    expect(ov.sparkHost.probeUrl).toBe('http://127.0.0.1:38081/healthz');
    expect(ov.notes.some((n) => n.includes('DGX_RESOURCE_SPARK_HOST_STATUS_URL'))).toBe(false);
  });

  it('sparkHost fallback reports stopped when admin /healthz is unreachable', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: true,
        baseUrl: 'http://127.0.0.1:38081',
        model: 'm1',
        timeoutMs: 60_000,
        health: { ok: false, statusCode: 503 },
      })),
      createChatCompletion: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const u = typeof input === 'string' ? input : (input as URL).href;
      if (u === 'http://127.0.0.1:38081/healthz') {
        return { ok: false, status: 503, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
      }
      return { ok: false, status: 404, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
    });

    const svc = makeSvc(store, gateway, {
      fetchImpl: fetchImpl as typeof fetch,
    });

    const ov = await svc.getOverview();
    expect(ov.optionalProbes.sparkHostConfigured).toBe(true);
    expect(ov.sparkHost.status).toBe('stopped');
    expect(ov.sparkHost.httpStatus).toBe(503);
    expect(ov.sparkHost.probeUrl).toBe('http://127.0.0.1:38081/healthz');
  });

  it('comfy comfyPolicy badge only under business_first', async () => {
    const store = new DgxResourcePolicyStore(10);
    store.setPolicyMode('private_ok');
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const fetchImpl = vi.fn(async (): Promise<Response> => ({
      ok: false,
      status: 503,
      headers: new Headers(),
      url: '',
      text: async () => '',
      json: async () => ({}),
    })) as typeof fetch;

    const svc = makeSvc(store, gateway, {
      fetchImpl,
      comfyHealthUrl: 'http://127.0.0.1:8188/health',
    });

    let ov = await svc.getOverview();
    const comfy = ov.services.find((s) => s.id === 'private-comfyui');
    expect(comfy?.badges).not.toContain('policy');

    store.setPolicyMode('business_first');
    ov = await svc.getOverview();
    const comfy2 = ov.services.find((s) => s.id === 'private-comfyui');
    expect(comfy2?.badges).toContain('policy');
  });

  it('rejects LOCAL_LLM_START when not on_demand or control URLs missing', async () => {
    const store = new DgxResourcePolicyStore(20);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await expect(svc.executeAction({ type: 'LOCAL_LLM_START' })).rejects.toThrow(ApiError);

    await expect(svc.executeAction({ type: 'LOCAL_LLM_START' })).rejects.toMatchObject({
      code: 'DGX_RUNTIME_CONTROL_NOT_CONFIGURED',
    });
  });

  it('getOverview includes targets registry aligned with legacy services', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);
    const ov = await svc.getOverview();

    expect(ov.targets).toHaveLength(7);
    expect(ov.targets.map((t) => t.id)).toEqual([
      'system-prod-gateway',
      'system-prod-inference',
      'system-prod-embedding',
      'private-comfyui',
      'experiment-lab',
      'spark-host',
      'metrics-kpi',
    ]);
    expect(ov.services).toHaveLength(5);
    const comfySvc = ov.services.find((s) => s.id === 'private-comfyui');
    const comfyTgt = ov.targets.find((t) => t.id === 'private-comfyui');
    expect(comfySvc?.status).toBe(comfyTgt?.status);
  });

  it('rejects EXECUTE_TARGET_ACTION start on read-only spark-host', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await expect(
      svc.executeAction({
        type: 'EXECUTE_TARGET_ACTION',
        targetId: 'spark-host',
        action: 'start',
      })
    ).rejects.toMatchObject({ code: 'DGX_TARGET_ACTION_NOT_SUPPORTED' });
  });

  it('EXECUTE_TARGET_ACTION gateway start delegates same as LOCAL_LLM_START when misconfigured', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await expect(
      svc.executeAction({
        type: 'EXECUTE_TARGET_ACTION',
        targetId: 'system-prod-gateway',
        action: 'start',
      })
    ).rejects.toMatchObject({ code: 'DGX_RUNTIME_CONTROL_NOT_CONFIGURED' });
  });

  it('does not change policy when workload adjustment fails before SET_POLICY', async () => {
    const prev = {
      expStart: env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL,
      expStop: env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_STOP_URL,
      expToken: env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_CONTROL_TOKEN,
      comfyStart: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL,
      comfyStop: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL,
      comfyToken: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN,
    };
    env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL = 'http://127.0.0.1:9191/experiment/start';
    env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_STOP_URL = 'http://127.0.0.1:9191/experiment/stop';
    env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_CONTROL_TOKEN = 'tok-xxx';
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL = undefined;
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL = undefined;
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN = undefined;

    try {
      const store = new DgxResourcePolicyStore(20);
      store.setPolicyMode('private_ok');
      const gateway: LocalLlmGateway = {
        getStatus: vi.fn(async () => ({
          configured: false,
          health: { ok: false },
        })),
        createChatCompletion: vi.fn(),
      };
      const fetchImpl = vi.fn(async (): Promise<Response> => ({
        ok: false,
        status: 503,
        headers: new Headers(),
        url: '',
        text: async () => 'experiment stop failed',
        json: async () => ({}),
      })) as typeof fetch;

      const svc = makeSvc(store, gateway, { fetchImpl });

      await expect(
        svc.executeAction({
          type: 'SET_POLICY',
          policyMode: 'business_first',
          applyWorkloadChanges: true,
        })
      ).rejects.toThrow(ApiError);

      const ov = await svc.getOverview();
      expect(ov.policy.mode).toBe('private_ok');
      expect(fetchImpl).toHaveBeenCalled();
      expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://127.0.0.1:9191/experiment/stop');
      expect(svc.getEvents(10).some((e) => e.message.includes('業務優先'))).toBe(false);
    } finally {
      env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL = prev.expStart;
      env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_STOP_URL = prev.expStop;
      env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_CONTROL_TOKEN = prev.expToken;
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL = prev.comfyStart;
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL = prev.comfyStop;
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN = prev.comfyToken;
    }
  });

  it('getOverview exposes monitoring.summary with stable shape', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);
    const ov = await svc.getOverview();

    expect(ov.monitoring.sparkSummaryJa.length > 0).toBe(true);
    expect(Array.isArray(ov.monitoring.alerts)).toBe(true);
    expect(Array.isArray(ov.monitoring.targetHighlights)).toBe(true);
    expect(ov.monitoring.lastScenarioFailure).toBeNull();
  });

  it('getOverview includes operator-facing console (workloads + actions)', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);
    const ov = await svc.getOverview();

    expect(ov.operator).toBeDefined();
    expect(ov.operator.workloads.map((w) => w.id)).toEqual(['business_vlm', 'private_comfy', 'experiment_lab']);
    expect(ov.operator.operatorActions).toHaveLength(4);
    expect(ov.operator.operatorSummary.policyMode).toBe(ov.policy.mode);
  });

  it('PREVIEW_ORCHESTRATION_SCENARIO returns planFingerprint; EXECUTE rejects stale fingerprint', async () => {
    const store = new DgxResourcePolicyStore(10);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    const preview = await svc.executeAction({
      type: 'PREVIEW_ORCHESTRATION_SCENARIO',
      scenarioId: 'business_to_private',
    });

    expect(preview.scenarioPreview).toBeTruthy();
    expect(preview.scenarioPreview?.planFingerprint).toMatch(/^[a-f0-9]{64}$/);

    await expect(
      svc.executeAction({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: 'business_to_private',
        planFingerprint: '0'.repeat(64),
        confirmed: true,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'DGX_SCENARIO_PLAN_STALE',
    });
  });

  it('business_to_private succeeds only after strict readiness is confirmed', async () => {
    const prev = {
      comfyStart: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL,
      comfyStop: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL,
      comfyToken: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN,
      readyTimeout: env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS,
      readyPoll: env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS,
    };
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL = 'http://127.0.0.1:8188/start';
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL = 'http://127.0.0.1:8188/stop';
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN = 'tok-private';
    env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS = 200;
    env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS = 10;

    try {
      const store = new DgxResourcePolicyStore(20);
      const gateway: LocalLlmGateway = {
        getStatus: vi.fn(async () => ({
          configured: false,
          health: { ok: false },
          timeoutMs: 60_000,
        })),
        createChatCompletion: vi.fn(),
      };
      const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
        const u = typeof input === 'string' ? input : (input as URL).href;
        if (u === 'http://127.0.0.1:8188/start' && init?.method === 'POST') {
          return { ok: true, status: 200, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
        }
        if (u === 'http://127.0.0.1:8188/health' && init?.method === 'GET') {
          return { ok: true, status: 200, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
        }
        return { ok: false, status: 404, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
      });

      const svc = makeSvc(store, gateway, {
        fetchImpl: fetchImpl as typeof fetch,
        comfyHealthUrl: 'http://127.0.0.1:8188/health',
      });

      const preview = await svc.executeAction({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: 'business_to_private',
      });
      const execute = await svc.executeAction({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: 'business_to_private',
        planFingerprint: preview.scenarioPreview!.planFingerprint,
        confirmed: true,
      });

      expect(execute.scenarioExecute?.success).toBe(true);
      expect(execute.scenarioExecute?.readinessSummaryJa).toContain('Strict Ready');
      expect(execute.scenarioExecute?.readinessChecksJa?.every((c) => c.satisfied)).toBe(true);
      expect(store.getPolicyMode()).toBe('private_ok');
    } finally {
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL = prev.comfyStart;
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL = prev.comfyStop;
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN = prev.comfyToken;
      env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS = prev.readyTimeout;
      env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS = prev.readyPoll;
    }
  });

  it('business_to_private timeout returns rollback details and restores prior policy', async () => {
    const prev = {
      comfyStart: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL,
      comfyStop: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL,
      comfyToken: env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN,
      readyTimeout: env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS,
      readyPoll: env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS,
    };
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL = 'http://127.0.0.1:8188/start';
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL = 'http://127.0.0.1:8188/stop';
    env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN = 'tok-private';
    env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS = 60;
    env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS = 10;

    try {
      const store = new DgxResourcePolicyStore(20);
      const gateway: LocalLlmGateway = {
        getStatus: vi.fn(async () => ({
          configured: false,
          health: { ok: false },
          timeoutMs: 60_000,
        })),
        createChatCompletion: vi.fn(),
      };
      const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
        const u = typeof input === 'string' ? input : (input as URL).href;
        if ((u === 'http://127.0.0.1:8188/start' || u === 'http://127.0.0.1:8188/stop') && init?.method === 'POST') {
          return { ok: true, status: 200, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
        }
        if (u === 'http://127.0.0.1:8188/health' && init?.method === 'GET') {
          return { ok: false, status: 503, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
        }
        return { ok: false, status: 404, headers: new Headers(), url: u, text: async () => '', json: async () => ({}) } as Response;
      });

      const svc = makeSvc(store, gateway, {
        fetchImpl: fetchImpl as typeof fetch,
        comfyHealthUrl: 'http://127.0.0.1:8188/health',
      });

      const preview = await svc.executeAction({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: 'business_to_private',
      });
      const execute = await svc.executeAction({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: 'business_to_private',
        planFingerprint: preview.scenarioPreview!.planFingerprint,
        confirmed: true,
      });

      expect(execute.scenarioExecute?.success).toBe(false);
      expect(execute.scenarioExecute?.rollback?.attempted).toBe(true);
      expect(execute.scenarioExecute?.rollback?.policyRestoredJa).toContain('業務優先');
      expect(store.getPolicyMode()).toBe('business_first');
      expect(execute.scenarioExecute?.readinessChecksJa?.some((c) => c.code === 'private_comfy' && !c.satisfied)).toBe(true);
    } finally {
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL = prev.comfyStart;
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL = prev.comfyStop;
      env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN = prev.comfyToken;
      env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS = prev.readyTimeout;
      env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS = prev.readyPoll;
    }
  });
});
