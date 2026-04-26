import type { InferenceProviderDefinition } from './inference-provider.types.js';

export function resolveAdminInferenceProvider(
  providers: InferenceProviderDefinition[],
  adminProviderId?: string
): InferenceProviderDefinition | undefined {
  const requestedId = adminProviderId?.trim();
  if (requestedId) {
    if (requestedId === 'default') {
      return providers.find((provider) => provider.id === 'default') ?? providers[0];
    }
    return providers.find((provider) => provider.id === requestedId);
  }
  return providers.find((provider) => provider.id === 'default') ?? providers[0];
}

export function resolveAdminInferenceModel(
  provider: InferenceProviderDefinition | undefined,
  modelOverride?: string
): string | undefined {
  const requestedModel = modelOverride?.trim();
  if (requestedModel) {
    return requestedModel;
  }
  const defaultModel = provider?.defaultModel?.trim();
  return defaultModel || undefined;
}
