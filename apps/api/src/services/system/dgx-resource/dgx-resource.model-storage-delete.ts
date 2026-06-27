import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';

import { createTimeoutSignal } from './dgx-resource.probes.js';

export type DgxModelStorageDeletePreview = {
  ok: true;
  modelProfileId: string;
  displayNameJa: string;
  canDelete: boolean;
  blockedReasons: Array<{ code: string; detailJa: string }>;
  storagePath: string | null;
  resolvedStoragePath: string | null;
  requiredConfirmation: string;
  planFingerprint: string | null;
  sizeBytes?: number;
  sizeGiB?: number;
  fileCount?: number;
  directoryCount?: number;
};

export type DgxModelStorageDeleteExecuteResult = {
  ok: true;
  modelProfileId: string;
  displayNameJa: string;
  deletedStoragePath: string;
  sizeBytes?: number | null;
  sizeGiB?: number | null;
  fileCount?: number | null;
  directoryCount?: number | null;
};

type GatewayErrorPayload = {
  message?: string;
  code?: string;
};

async function readGatewayError(response: Response): Promise<GatewayErrorPayload> {
  try {
    const body = (await response.json()) as GatewayErrorPayload;
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

async function postGatewayModelStorageDelete<T>(input: {
  baseUrl?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  path: '/system/model-storage-delete/preview' | '/system/model-storage-delete/execute';
  body: Record<string, unknown>;
}): Promise<T> {
  if (!input.baseUrl) {
    throw new ApiError(
      503,
      'DGX gateway baseUrl が未設定のためモデル保存先を操作できません',
      {},
      'DGX_GATEWAY_UNCONFIGURED'
    );
  }
  if (!env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN) {
    throw new ApiError(
      503,
      'LOCAL_LLM_RUNTIME_CONTROL_TOKEN が未設定のためモデル保存先を操作できません',
      {},
      'DGX_RUNTIME_CONTROL_NOT_CONFIGURED'
    );
  }

  const { signal, cleanup } = createTimeoutSignal(input.timeoutMs);
  try {
    const response = await input.fetchImpl(new URL(input.path, input.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Runtime-Control-Token': env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN,
      },
      body: JSON.stringify(input.body),
      signal,
    });
    if (!response.ok) {
      const error = await readGatewayError(response);
      throw new ApiError(
        response.status,
        error.message ?? `DGX model storage delete API が HTTP ${response.status} を返しました`,
        { gatewayCode: error.code },
        error.code ?? 'DGX_MODEL_STORAGE_DELETE_GATEWAY_ERROR'
      );
    }
    return (await response.json()) as T;
  } finally {
    cleanup();
  }
}

export async function previewDgxModelStorageDelete(input: {
  baseUrl?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  modelProfileId: string;
}): Promise<DgxModelStorageDeletePreview> {
  return postGatewayModelStorageDelete<DgxModelStorageDeletePreview>({
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    path: '/system/model-storage-delete/preview',
    body: { modelProfileId: input.modelProfileId },
  });
}

export async function executeDgxModelStorageDelete(input: {
  baseUrl?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  modelProfileId: string;
  planFingerprint: string;
  confirmation: string;
}): Promise<DgxModelStorageDeleteExecuteResult> {
  return postGatewayModelStorageDelete<DgxModelStorageDeleteExecuteResult>({
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    path: '/system/model-storage-delete/execute',
    body: {
      modelProfileId: input.modelProfileId,
      planFingerprint: input.planFingerprint,
      confirmation: input.confirmation,
    },
  });
}
