import type { InferenceProviderDefinition, InferenceProviderRuntimeControlDefinition } from '../config/inference-provider.types.js';
import {
  buildOnDemandControllerCacheKey,
  type InferenceRuntimeIntentEnv,
} from '../config/inference-use-case-runtime-intent.js';
import { InferenceRouter } from '../routing/inference-router.js';
import type { InferenceUseCase } from '../types/inference-usecase.js';

import { HttpOnDemandLocalLlmRuntimeController } from './http-on-demand-local-llm-runtime.controller.js';
import type { LocalLlmRuntimeControllerPort, LocalLlmRuntimeUseCase } from './local-llm-runtime-control.port.js';
import { NoopLocalLlmRuntimeController } from './noop-local-llm-runtime.controller.js';

const ROUTED_RUNTIME_USE_CASES: readonly InferenceUseCase[] = ['photo_label', 'document_summary'];

type ProviderLocalLlmRuntimeControllerDeps = {
  fetchImpl: typeof fetch;
  globalMode: 'always_on' | 'on_demand';
  router: InferenceRouter;
  providers: InferenceProviderDefinition[];
  resolveAdminProvider: () => InferenceProviderDefinition | undefined;
  resolveAdminModel: () => string;
  readyTimeoutMs: number;
  startRequestTimeoutMs: number;
  stopRequestTimeoutMs: number;
  healthPollIntervalMs: number;
  legacyAdminRuntimeControl?: InferenceProviderRuntimeControlDefinition;
  /** Agent コンテナ（gateway の agent-container/start|stop）。未設定時は agent_container_task は no-op */
  agentContainerRuntimeControl?: {
    startUrl: string;
    stopUrl: string;
    controlToken: string;
    optionalSimpleHealthProbeUrl: string;
  };
  /** 全 HttpOnDemand インスタンスで共有。true のとき release で /stop を抑止 */
  shouldSuppressStop?: (useCase: LocalLlmRuntimeUseCase) => boolean;
  runtimeIntentEnv: InferenceRuntimeIntentEnv;
};

class InvalidOnDemandLocalLlmRuntimeController implements LocalLlmRuntimeControllerPort {
  constructor(private readonly providerId: string) {}

  getMode(): 'on_demand' {
    return 'on_demand';
  }

  async ensureReady(): Promise<void> {
    throw new Error(`LocalLlmRuntimeControl: on_demand config incomplete for provider=${this.providerId}`);
  }

  async release(): Promise<void> {}
}

export class ProviderLocalLlmRuntimeController implements LocalLlmRuntimeControllerPort {
  private readonly noopController = new NoopLocalLlmRuntimeController();

  private readonly controllersByCacheKey = new Map<string, LocalLlmRuntimeControllerPort>();

  /**
   * ensureReady 時に固定した HttpOnDemand インスタンス。
   * release 時に store 再解決すると別 profile の controller に触れ refCount がずれる。
   */
  private readonly leasedControllerByUseCase = new Map<LocalLlmRuntimeUseCase, LocalLlmRuntimeControllerPort>();

  private agentContainerRuntimeResolved: LocalLlmRuntimeControllerPort | undefined;

  constructor(private readonly deps: ProviderLocalLlmRuntimeControllerDeps) {}

  getMode(): 'always_on' | 'on_demand' {
    return this.deps.globalMode;
  }

  async ensureReady(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    const controller = this.acquireLeasedController(useCase);
    try {
      await controller.ensureReady(useCase);
    } catch (error) {
      this.releaseFailedLease(useCase, controller);
      throw error;
    }
  }

  async release(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    const controller = this.leasedControllerByUseCase.get(useCase);
    if (!controller) {
      await this.resolveController(useCase).release(useCase);
      return;
    }
    await controller.release(useCase);
    if (controller instanceof HttpOnDemandLocalLlmRuntimeController && controller.getInFlightRefCount() === 0) {
      this.leasedControllerByUseCase.delete(useCase);
    }
  }

  private acquireLeasedController(useCase: LocalLlmRuntimeUseCase): LocalLlmRuntimeControllerPort {
    const existing = this.leasedControllerByUseCase.get(useCase);
    if (existing) {
      return existing;
    }
    const controller = this.resolveController(useCase);
    this.leasedControllerByUseCase.set(useCase, controller);
    return controller;
  }

  private releaseFailedLease(useCase: LocalLlmRuntimeUseCase, controller: LocalLlmRuntimeControllerPort): void {
    const leased = this.leasedControllerByUseCase.get(useCase);
    if (leased === controller) {
      this.leasedControllerByUseCase.delete(useCase);
    }
  }

  private resolveController(useCase: LocalLlmRuntimeUseCase): LocalLlmRuntimeControllerPort {
    if (useCase === 'agent_container_task') {
      return this.resolveAgentContainerRuntimeController();
    }
    const provider = this.resolveProvider(useCase);
    if (!provider) {
      return this.noopController;
    }
    const cacheKey = buildOnDemandControllerCacheKey(provider, useCase, this.deps.runtimeIntentEnv);
    const cached = this.controllersByCacheKey.get(cacheKey);
    if (cached) {
      return cached;
    }
    const created = this.createControllerForProvider(provider);
    this.controllersByCacheKey.set(cacheKey, created);
    return created;
  }

  private resolveProvider(useCase: LocalLlmRuntimeUseCase): InferenceProviderDefinition | undefined {
    if (useCase === 'agent_container_task') {
      return undefined;
    }
    if (useCase === 'admin_console_chat' || useCase === 'stackchan_chat') {
      return this.deps.resolveAdminProvider();
    }
    try {
      return this.deps.router.resolve(useCase).provider;
    } catch {
      return undefined;
    }
  }

  private createControllerForProvider(provider: InferenceProviderDefinition): LocalLlmRuntimeControllerPort {
    if (this.deps.globalMode !== 'on_demand') {
      return this.noopController;
    }

    const runtimeControl = this.resolveRuntimeControl(provider);
    if (!runtimeControl || runtimeControl.mode === 'always_on') {
      return this.noopController;
    }

    const startUrl = runtimeControl.startUrl?.trim();
    const stopUrl = runtimeControl.stopUrl?.trim();
    const controlToken = runtimeControl.controlToken?.trim() || provider.sharedToken?.trim() || '';
    const healthBaseUrl = runtimeControl.healthBaseUrl?.trim() || provider.baseUrl?.trim() || '';

    if (!startUrl || !stopUrl || !controlToken || !healthBaseUrl) {
      return new InvalidOnDemandLocalLlmRuntimeController(provider.id);
    }

    return new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl: this.deps.fetchImpl,
      startUrl,
      stopUrl,
      controlToken,
      healthCheckBaseUrl: healthBaseUrl,
      llmToken: provider.sharedToken,
      readyProbeModels: this.buildReadyProbeModels(provider),
      readyTimeoutMs: this.deps.readyTimeoutMs,
      startRequestTimeoutMs: this.deps.startRequestTimeoutMs,
      stopRequestTimeoutMs: this.deps.stopRequestTimeoutMs,
      healthPollIntervalMs: this.deps.healthPollIntervalMs,
      shouldSuppressStop: this.deps.shouldSuppressStop,
      runtimeIntentEnv: this.deps.runtimeIntentEnv,
      provider,
    });
  }

  private resolveRuntimeControl(
    provider: InferenceProviderDefinition
  ): InferenceProviderRuntimeControlDefinition | undefined {
    if (provider.runtimeControl) {
      return provider.runtimeControl;
    }
    const adminProvider = this.deps.resolveAdminProvider();
    if (adminProvider && adminProvider.id === provider.id) {
      return this.deps.legacyAdminRuntimeControl;
    }
    return undefined;
  }

  private buildReadyProbeModels(
    provider: InferenceProviderDefinition
  ): Partial<Record<LocalLlmRuntimeUseCase, string>> {
    const models: Partial<Record<LocalLlmRuntimeUseCase, string>> = {};
    const adminProvider = this.deps.resolveAdminProvider();
    if (adminProvider?.id === provider.id) {
      const adminModel = this.deps.resolveAdminModel();
      models.admin_console_chat = adminModel;
      models.stackchan_chat = adminModel;
    }
    for (const useCase of ROUTED_RUNTIME_USE_CASES) {
      try {
        const resolved = this.deps.router.resolve(useCase);
        if (resolved.provider.id === provider.id) {
          models[useCase] = resolved.model;
        }
      } catch {
        // unresolved use case is handled by caller side
      }
    }
    return models;
  }

  private resolveAgentContainerRuntimeController(): LocalLlmRuntimeControllerPort {
    if (this.agentContainerRuntimeResolved !== undefined) {
      return this.agentContainerRuntimeResolved;
    }
    const cfg = this.deps.agentContainerRuntimeControl;
    if (!cfg) {
      this.agentContainerRuntimeResolved = this.noopController;
      return this.agentContainerRuntimeResolved;
    }
    if (this.deps.globalMode !== 'on_demand') {
      this.agentContainerRuntimeResolved = this.noopController;
      return this.agentContainerRuntimeResolved;
    }
    this.agentContainerRuntimeResolved = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl: this.deps.fetchImpl,
      startUrl: cfg.startUrl,
      stopUrl: cfg.stopUrl,
      controlToken: cfg.controlToken,
      healthCheckBaseUrl: cfg.optionalSimpleHealthProbeUrl,
      llmToken: '',
      optionalSimpleHealthProbeUrl: cfg.optionalSimpleHealthProbeUrl,
      readyTimeoutMs: this.deps.readyTimeoutMs,
      startRequestTimeoutMs: this.deps.startRequestTimeoutMs,
      stopRequestTimeoutMs: this.deps.stopRequestTimeoutMs,
      healthPollIntervalMs: this.deps.healthPollIntervalMs,
      shouldSuppressStop: this.deps.shouldSuppressStop,
      runtimeIntentEnv: this.deps.runtimeIntentEnv,
    });
    return this.agentContainerRuntimeResolved;
  }
}
