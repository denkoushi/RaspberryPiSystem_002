/** 固定 profile 起動ボタン（DGX リソース UI）。ラベルは modelProfileId と同一表示。 */
export const DGX_QUICK_START_MODEL_PROFILE_ID = 'qwen36_35b_uncensored' as const;

export type DgxQuickStartModelProfileId = typeof DGX_QUICK_START_MODEL_PROFILE_ID;

export const DGX_QUICK_START_MODEL_PROFILES: ReadonlyArray<{
  modelProfileId: DgxQuickStartModelProfileId;
  label: string;
}> = [{ modelProfileId: DGX_QUICK_START_MODEL_PROFILE_ID, label: DGX_QUICK_START_MODEL_PROFILE_ID }];
