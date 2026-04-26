import type { InferenceProviderDefinition, InferenceProviderRuntimeControlDefinition } from '../config/inference-provider.types.js';
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
  resolveAdminModel: () => string;
  readyTimeoutMs: number;
  startRequestTimeoutMs: number;
  stopRequestTimeoutMs: number;
  healthPollIntervalMs: number;
  legacyPrimaryRuntimeControl?: InferenceProviderRuntimeControlDefinition;
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

  private readonly controllersByProviderId = new Map<string, LocalLlmRuntimeControllerPort>();

  constructor(private readonly deps: ProviderLocalLlmRuntimeControllerDeps) {}

  getMode(): 'always_on' | 'on_demand' {
    return this.deps.globalMode;
  }

  async ensureReady(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    await this.resolveController(useCase).ensureReady(useCase);
  }

  async release(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    await this.resolveController(useCase).release(useCase);
  }

  private resolveController(useCase: LocalLlmRuntimeUseCase): LocalLlmRuntimeControllerPort {
    const provider = this.resolveProvider(useCase);
    if (!provider) {
      return this.noopController;
    }
    const cached = this.controllersByProviderId.get(provider.id);
    if (cached) {
      return cached;
    }
    const created = this.createControllerForProvider(provider);
    this.controllersByProviderId.set(provider.id, created);
    return created;
  }

  private resolveProvider(useCase: LocalLlmRuntimeUseCase): InferenceProviderDefinition | undefined {
    if (useCase === 'admin_console_chat') {
      return this.resolvePrimaryProvider();
    }
    try {
      return this.deps.router.resolve(useCase).provider;
    } catch {
      return undefined;
    }
  }

  private resolvePrimaryProvider(): InferenceProviderDefinition | undefined {
    return this.deps.providers.find((p) => p.id === 'default') ?? this.deps.providers[0];
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
    });
  }

  private resolveRuntimeControl(
    provider: InferenceProviderDefinition
  ): InferenceProviderRuntimeControlDefinition | undefined {
    if (provider.runtimeControl) {
      return provider.runtimeControl;
    }
    const primary = this.resolvePrimaryProvider();
    if (primary && primary.id === provider.id) {
      return this.deps.legacyPrimaryRuntimeControl;
    }
    return undefined;
  }

  private buildReadyProbeModels(
    provider: InferenceProviderDefinition
  ): Partial<Record<LocalLlmRuntimeUseCase, string>> {
    const models: Partial<Record<LocalLlmRuntimeUseCase, string>> = {};
    const primary = this.resolvePrimaryProvider();
    if (primary?.id === provider.id) {
      models.admin_console_chat = this.deps.resolveAdminModel();
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
}
