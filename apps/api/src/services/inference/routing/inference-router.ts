import type { InferenceProviderDefinition } from '../config/inference-provider.types.js';
import type { InferenceUseCase } from '../types/inference-usecase.js';

export type InferenceRouteTarget = {
  providerId: string;
  /** 未指定時は provider.defaultModel */
  modelOverride?: string;
};

export type InferenceRouterConfig = {
  providers: InferenceProviderDefinition[];
  routes: Record<InferenceUseCase, InferenceRouteTarget>;
};

export class InferenceRouter {
  private readonly providersById: Map<string, InferenceProviderDefinition>;

  constructor(
    private readonly config: InferenceRouterConfig,
    providersById?: Map<string, InferenceProviderDefinition>
  ) {
    this.providersById =
      providersById ?? new Map(config.providers.map((p) => [p.id, p] as const));
  }

  listProviders(): InferenceProviderDefinition[] {
    return [...this.providersById.values()];
  }

  resolve(useCase: InferenceUseCase): { provider: InferenceProviderDefinition; model: string } {
    const target = this.config.routes[useCase];
    const provider = this.providersById.get(target.providerId);
    if (!provider) {
      throw new Error(`Inference provider not found: ${target.providerId}`);
    }
    const model = target.modelOverride?.trim() || provider.defaultModel;
    if (!model) {
      throw new Error(`Inference model missing for useCase=${useCase} provider=${provider.id}`);
    }
    return { provider, model };
  }

  isResolvable(useCase: InferenceUseCase): boolean {
    try {
      this.resolve(useCase);
      return true;
    } catch {
      return false;
    }
  }
}
