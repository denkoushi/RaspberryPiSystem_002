export const HERMES_JEV_TRIAL_CONTRACT = Object.freeze({
  syntheticInitialRequest: '架空対象の記録を確認したい',
  syntheticReply: '架空対象Aでお願いします',
  syntheticResolvedCondition: '対象=架空対象A',
  displayOnlyOriginalText: '【架空対象A】\n原文: これは画面表示専用で、JEVへ送信しない。',
  confirmationQuestion: '検索対象を指定してください。架空対象Aまたは架空対象Bを入力してください。',
  confirmationPurpose: 'collect_missing_values',
  confirmationItem: Object.freeze({
    id: 'target',
    label: '検索対象',
    type: 'string',
    candidates: Object.freeze(['架空対象A', '架空対象B'])
  })
});

export function syntheticConfirmationPending(confirmedInfo = {}) {
  return {
    request: 'synthetic-confirmation-v1',
    question: HERMES_JEV_TRIAL_CONTRACT.confirmationQuestion,
    purpose: HERMES_JEV_TRIAL_CONTRACT.confirmationPurpose,
    requiredItems: [{ ...HERMES_JEV_TRIAL_CONTRACT.confirmationItem }],
    confirmedInfo: { ...confirmedInfo },
    unresolvedItems: Object.hasOwn(confirmedInfo, 'target') ? [] : ['target']
  };
}

export function isSyntheticTrialRequest(value) {
  return typeof value === 'string' && [
    HERMES_JEV_TRIAL_CONTRACT.syntheticInitialRequest,
    HERMES_JEV_TRIAL_CONTRACT.syntheticReply,
    '架空対象Bでお願いします'
  ].includes(value);
}

// This is the only place where the fixed fixture's A/B values are mapped to
// the local search condition. Confirmation/classification code stays generic.
export function syntheticConditionFromResolution(resolution) {
  const target = resolution?.confirmedInfo?.target;
  if (!resolution?.canProceed || !['架空対象A', '架空対象B'].includes(target)) return null;
  return `対象=${target}`;
}
