import type { InferenceProviderDefinition } from './inference-provider.types.js';
import { resolveAdminInferenceModel, resolveAdminInferenceProvider } from './admin-inference-provider.js';

/**
 * env.ts から渡す LOCAL_LLM / 用途別 provider id のスライス。
 * 推論ドメインの詳細（fetch 等）には依存しない。
 */
export type LocalLlmAlignmentEnvSlice = {
  LOCAL_LLM_BASE_URL?: string;
  LOCAL_LLM_SHARED_TOKEN?: string;
  LOCAL_LLM_MODEL?: string;
  LOCAL_LLM_RUNTIME_MODE: 'always_on' | 'on_demand';
  LOCAL_LLM_RUNTIME_CONTROL_START_URL?: string;
  LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?: string;
  LOCAL_LLM_RUNTIME_CONTROL_TOKEN?: string;
  INFERENCE_ADMIN_PROVIDER_ID: string;
  INFERENCE_ADMIN_MODEL?: string;
  INFERENCE_PHOTO_LABEL_PROVIDER_ID: string;
  INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: string;
};

export type LocalLlmAlignmentIssue = {
  path: (string | number)[];
  message: string;
};

/**
 * INFERENCE_PROVIDERS_JSON 由来の providers と LOCAL_LLM_* の整合を検査する。
 * - 管理系 LocalLLM プロキシは「id=default があればそれ、なければ先頭」を primary とみなす（inference-runtime と同型）。
 * - LOCAL_LLM の3点組（baseUrl / sharedToken / model）が揃っていないときは primary との厳密一致はスキップ（段階的セットアップを許容）。
 * - 用途別 route の provider id が配列に存在することは常に検査する。
 */
export function collectLocalLlmProviderAlignmentIssues(
  providers: InferenceProviderDefinition[],
  slice: LocalLlmAlignmentEnvSlice
): LocalLlmAlignmentIssue[] {
  const issues: LocalLlmAlignmentIssue[] = [];
  if (providers.length === 0) {
    return issues;
  }

  const ids = new Set(providers.map((p) => p.id));
  const referencedProviderIds = [
    slice.INFERENCE_PHOTO_LABEL_PROVIDER_ID,
    slice.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID,
  ];
  const adminProviderId = slice.INFERENCE_ADMIN_PROVIDER_ID?.trim();
  if (adminProviderId && adminProviderId !== 'default') {
    referencedProviderIds.unshift(adminProviderId);
  }
  for (const routeId of referencedProviderIds) {
    if (!ids.has(routeId)) {
      issues.push({
        path: ['INFERENCE_PROVIDERS_JSON'],
        message: `Inference route references unknown provider id "${routeId}" (not in INFERENCE_PROVIDERS_JSON)`,
      });
    }
  }

  const baseUrl = slice.LOCAL_LLM_BASE_URL?.trim();
  const shared = slice.LOCAL_LLM_SHARED_TOKEN?.trim();
  const model = slice.LOCAL_LLM_MODEL?.trim();
  if (!baseUrl || !shared || !model) {
    return issues;
  }

  const adminProvider = resolveAdminInferenceProvider(providers, slice.INFERENCE_ADMIN_PROVIDER_ID);
  if (!adminProvider) {
    return issues;
  }
  const adminModel = resolveAdminInferenceModel(adminProvider, slice.INFERENCE_ADMIN_MODEL);

  if (adminProvider.baseUrl !== baseUrl) {
    issues.push({
      path: ['LOCAL_LLM_BASE_URL', 'INFERENCE_PROVIDERS_JSON'],
      message:
        'LOCAL_LLM_BASE_URL must match admin inference provider baseUrl (INFERENCE_ADMIN_PROVIDER_ID, default if present, else first provider)',
    });
  }
  if (adminProvider.sharedToken !== shared) {
    issues.push({
      path: ['LOCAL_LLM_SHARED_TOKEN', 'INFERENCE_PROVIDERS_JSON'],
      message:
        'LOCAL_LLM_SHARED_TOKEN must match admin inference provider sharedToken (Pi5 vault と DGX api-token のドリフトを防ぐ)',
    });
  }
  if (adminModel !== model) {
    issues.push({
      path: ['LOCAL_LLM_MODEL', 'INFERENCE_PROVIDERS_JSON'],
      message: 'LOCAL_LLM_MODEL must match admin inference provider model (INFERENCE_ADMIN_MODEL or provider.defaultModel)',
    });
  }

  if (slice.LOCAL_LLM_RUNTIME_MODE === 'on_demand') {
    const rc = adminProvider.runtimeControl;
    const startU = slice.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim();
    const stopU = slice.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim();

    if (!startU) {
      issues.push({
        path: ['LOCAL_LLM_RUNTIME_CONTROL_START_URL'],
        message: 'LOCAL_LLM_RUNTIME_MODE=on_demand requires LOCAL_LLM_RUNTIME_CONTROL_START_URL',
      });
    }
    if (!stopU) {
      issues.push({
        path: ['LOCAL_LLM_RUNTIME_CONTROL_STOP_URL'],
        message: 'LOCAL_LLM_RUNTIME_MODE=on_demand requires LOCAL_LLM_RUNTIME_CONTROL_STOP_URL',
      });
    }

    if (!rc || rc.mode !== 'on_demand') {
      issues.push({
        path: ['LOCAL_LLM_RUNTIME_MODE', 'INFERENCE_PROVIDERS_JSON'],
        message:
          'LOCAL_LLM_RUNTIME_MODE=on_demand requires admin inference provider runtimeControl.mode=on_demand',
      });
    } else {
      if (!rc.startUrl?.trim()) {
        issues.push({
          path: ['INFERENCE_PROVIDERS_JSON'],
          message: 'admin inference provider runtimeControl.startUrl is required when LOCAL_LLM_RUNTIME_MODE=on_demand',
        });
      } else if (startU && rc.startUrl !== startU) {
        issues.push({
          path: ['LOCAL_LLM_RUNTIME_CONTROL_START_URL', 'INFERENCE_PROVIDERS_JSON'],
          message: 'LOCAL_LLM_RUNTIME_CONTROL_START_URL must match admin inference provider runtimeControl.startUrl',
        });
      }
      if (!rc.stopUrl?.trim()) {
        issues.push({
          path: ['INFERENCE_PROVIDERS_JSON'],
          message: 'admin inference provider runtimeControl.stopUrl is required when LOCAL_LLM_RUNTIME_MODE=on_demand',
        });
      } else if (stopU && rc.stopUrl !== stopU) {
        issues.push({
          path: ['LOCAL_LLM_RUNTIME_CONTROL_STOP_URL', 'INFERENCE_PROVIDERS_JSON'],
          message: 'LOCAL_LLM_RUNTIME_CONTROL_STOP_URL must match admin inference provider runtimeControl.stopUrl',
        });
      }
      const effectiveLocal = slice.LOCAL_LLM_RUNTIME_CONTROL_TOKEN?.trim() || shared;
      const effectiveProv = rc.controlToken?.trim() || adminProvider.sharedToken;
      if (effectiveLocal !== effectiveProv) {
        issues.push({
          path: ['LOCAL_LLM_RUNTIME_CONTROL_TOKEN', 'INFERENCE_PROVIDERS_JSON'],
          message:
            'Effective runtime control token must match admin inference provider (LOCAL_LLM_RUNTIME_CONTROL_TOKEN if set, else LOCAL_LLM_SHARED_TOKEN) === (runtimeControl.controlToken if set, else sharedToken)',
        });
      }
    }
  } else if (adminProvider.runtimeControl?.mode === 'on_demand') {
    issues.push({
      path: ['LOCAL_LLM_RUNTIME_MODE', 'INFERENCE_PROVIDERS_JSON'],
      message:
        'LOCAL_LLM_RUNTIME_MODE=always_on but admin inference provider declares runtimeControl.mode=on_demand; align LOCAL_LLM_RUNTIME_MODE and provider runtimeControl',
    });
  }

  return issues;
}
