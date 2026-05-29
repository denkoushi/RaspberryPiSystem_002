import type { LocalLlmRuntimeUseCase } from '../runtime/local-llm-runtime-control.port.js';

import {
  type DgxActiveModelRuntimeState,
  parseDgxActiveModelRuntimeState,
} from '../../system/dgx-resource/dgx-resource.model-profiles.js';

export type { DgxActiveModelRuntimeState };

export const CAPABILITY_VISION = 'vision';

/** 業務 on-demand で profile 実送信後に DGX state を検証する用途 */
export type BusinessRuntimeReadinessVerifyInput = {
  fetchImpl: typeof fetch;
  modelProfilesBaseUrl: string;
  llmToken: string;
  expectedProfileId: string;
  useCase: LocalLlmRuntimeUseCase;
  timeoutMs: number;
};

export type GatewayModelProfilesBody = {
  ok?: boolean;
  activeProfileId?: unknown;
  state?: unknown;
};

export function useCaseRequiresVision(useCase: LocalLlmRuntimeUseCase): boolean {
  return useCase === 'photo_label';
}

export function buildRuntimeStartRequestBody(input: {
  useCase: LocalLlmRuntimeUseCase;
  sendProfile: boolean;
  profileId?: string;
}): Record<string, string> {
  const body: Record<string, string> = { reason: input.useCase };
  if (input.sendProfile && input.profileId?.trim()) {
    body.modelProfileId = input.profileId.trim();
  }
  return body;
}

export function assertActiveProfileIdMatches(
  activeProfileId: string | null,
  expectedProfileId: string
): void {
  if (activeProfileId === null) {
    throw new Error(
      `LocalLlmRuntimeControl: DGX active profile is unset (expected ${expectedProfileId}); profile-scoped /start may still be loading`
    );
  }
  if (activeProfileId !== expectedProfileId) {
    throw new Error(
      `LocalLlmRuntimeControl: DGX active profile mismatch (expected ${expectedProfileId}, actual ${activeProfileId})`
    );
  }
}

export function assertRuntimeCapabilitiesForUseCase(
  state: DgxActiveModelRuntimeState,
  useCase: LocalLlmRuntimeUseCase
): void {
  if (!useCaseRequiresVision(useCase)) {
    return;
  }
  if (!state.runtimeReadyCapabilities.includes(CAPABILITY_VISION)) {
    const reason = state.visionReadyReason ?? 'unknown';
    throw new Error(
      `LocalLlmRuntimeControl: active profile lacks vision runtime capability for ${useCase} (visionReadyReason=${reason})`
    );
  }
}

export async function fetchDgxActiveModelState(input: {
  fetchImpl: typeof fetch;
  modelProfilesBaseUrl: string;
  llmToken: string;
  timeoutMs: number;
}): Promise<{ activeProfileId: string | null; state: DgxActiveModelRuntimeState | null }> {
  const url = new URL('/system/model-profiles', input.modelProfilesBaseUrl);
  const response = await input.fetchImpl(url, {
    method: 'GET',
    headers: { 'X-LLM-Token': input.llmToken },
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`LocalLlmRuntimeControl: model profiles HTTP ${response.status}`);
  }
  const body = (await response.json()) as GatewayModelProfilesBody;
  const activeProfileId =
    typeof body.activeProfileId === 'string' && body.activeProfileId.trim() ? body.activeProfileId.trim() : null;
  const state = parseDgxActiveModelRuntimeState(body.state);
  return { activeProfileId, state };
}

/**
 * profile 付き /start のあと、HTTP ready に加え DGX active state と用途別 capability を確認する。
 */
export async function verifyBusinessRuntimeAfterProfileStart(
  input: BusinessRuntimeReadinessVerifyInput
): Promise<void> {
  const { activeProfileId, state } = await fetchDgxActiveModelState({
    fetchImpl: input.fetchImpl,
    modelProfilesBaseUrl: input.modelProfilesBaseUrl,
    llmToken: input.llmToken,
    timeoutMs: input.timeoutMs,
  });
  assertActiveProfileIdMatches(activeProfileId, input.expectedProfileId);
  if (state) {
    assertRuntimeCapabilitiesForUseCase(state, input.useCase);
  }
}

export function evaluateVisionRuntimeReadyFromOverview(input: {
  activeProfileId: string | null;
  activeRuntimeState: DgxActiveModelRuntimeState | null;
  selectedProfileId: string;
  selectedDeclaresVision: boolean;
}): { satisfied: boolean; detailJa: string } {
  if (!input.selectedDeclaresVision) {
    return {
      satisfied: true,
      detailJa: '選択 profile は vision 未宣言（runtime capability チェックは省略）',
    };
  }
  if (input.activeProfileId === null) {
    return {
      satisfied: false,
      detailJa: `DGX active profile 未設定のため vision ready を確認できません（選択: ${input.selectedProfileId}）`,
    };
  }
  if (input.activeProfileId !== input.selectedProfileId) {
    return {
      satisfied: false,
      detailJa: `active profile 不一致のため vision ready を確認できません`,
    };
  }
  if (!input.activeRuntimeState) {
    return {
      satisfied: false,
      detailJa: 'DGX state に runtimeReadyCapabilities がありません',
    };
  }
  if (!input.activeRuntimeState.runtimeReadyCapabilities.includes(CAPABILITY_VISION)) {
    const reason = input.activeRuntimeState.visionReadyReason ?? 'unknown';
    return {
      satisfied: false,
      detailJa: `選択モデルは vision 宣言済みですが、今回の起動では vision runtime が未 ready です（${reason}）`,
    };
  }
  return {
    satisfied: true,
    detailJa: `選択モデルの vision runtime が ready です（${input.activeRuntimeState.visionReadyReason ?? 'vision'})`,
  };
}
