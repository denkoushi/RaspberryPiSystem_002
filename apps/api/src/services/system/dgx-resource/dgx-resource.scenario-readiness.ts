import { evaluateVisionRuntimeReadyFromOverview } from '../../inference/config/business-runtime-readiness.js';

import { profileDeclaresVision, type DgxModelProfilesOverview } from './dgx-resource.model-profiles.js';

export type BusinessReadinessSnapshot = {
  llmState: 'ok' | 'down' | 'unconfigured';
  modelProfiles: DgxModelProfilesOverview;
};

function businessReady(snapshot: BusinessReadinessSnapshot, profileId: string): boolean {
  const profiles = snapshot.modelProfiles;
  const selected = profiles.available.find((profile) => profile.id === profileId);
  if (snapshot.llmState !== 'ok' || profiles.status !== 'ok' || !selected || profiles.activeProfileId !== profileId) {
    return false;
  }
  if (profiles.activeStateBackend && profiles.activeStateBackend !== selected.backend) return false;
  return evaluateVisionRuntimeReadyFromOverview({
    activeProfileId: profiles.activeProfileId,
    activeRuntimeState: profiles.activeRuntimeState,
    selectedProfileId: profileId,
    selectedDeclaresVision: profileDeclaresVision(selected),
  }).satisfied;
}

/** Two consecutive ready observations, with at most one idempotent /start retry. */
export async function waitBusinessReadiness(input: {
  collect: () => Promise<BusinessReadinessSnapshot>;
  modelProfileId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  retryStart: () => Promise<void>;
}): Promise<boolean> {
  const deadline = Date.now() + input.timeoutMs;
  let streak = 0;
  let retried = false;
  while (Date.now() < deadline) {
    const ready = businessReady(await input.collect(), input.modelProfileId);
    if (Date.now() >= deadline) return false;
    streak = ready ? streak + 1 : 0;
    if (streak >= 2) return true;
    if (!ready && !retried) {
      retried = true;
      await input.retryStart();
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(input.pollIntervalMs, remaining)));
  }
  return false;
}
