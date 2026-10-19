function uniqueWinner(result) {
  if (!Array.isArray(result?.option_ids) || !Array.isArray(result?.probabilities)
      || result.option_ids.length !== result.probabilities.length || result.probabilities.length === 0
      || result.probabilities.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Invalid JEV scores');
  }
  const maximum = Math.max(...result.probabilities);
  const indexes = result.probabilities.flatMap((score, index) => score === maximum ? [index] : []);
  return indexes.length === 1 ? result.option_ids[indexes[0]] : null;
}

export const RELATION_OPTIONS = [
  { id: 'new_request', description: '新しい依頼であり、まだ取得・提示されていない情報や処理を求めている。' },
  { id: 'existing_result_followup', description: '直前に取得・提示された結果について追加で尋ねている。' },
  { id: 'confirmation_reply', description: '直前の確認質問に対する回答である。' },
  { id: 'correction_or_refinement', description: '直前の依頼を訂正、変更、または条件追加している。' },
  { id: 'unknown', description: '会話の文脈が不足し、依頼の関係を一つに決められない。' }
];

export const ACTION_OPTIONS = [
  { id: 'find_or_list', description: '対象となる情報を探し、一覧または件数として確認したい。' },
  { id: 'inspect_detail', description: '特定の対象の内容、項目、理由、処置などを詳しく確認したい。' },
  { id: 'compare_or_summarize', description: '複数の情報を比較、集計、要約し、違いや傾向を知りたい。' },
  { id: 'explain', description: '検索や一覧化ではなく、内容や意味を説明してほしい。' },
  { id: 'change_request', description: '直前の依頼そのものを変更、訂正、または取り消したい。追加の情報を探す依頼は含めない。' },
  { id: 'confirm_or_proceed', description: '直前の確認を受け入れ、その条件で処理を進めてほしい。' },
  { id: 'provide_missing_value', description: '確認質問で求められた不足情報を答えたい。' },
  { id: 'unknown', description: '依頼の目的を一つに決められない。' }
];

export const GOAL_OPTIONS = ACTION_OPTIONS;
export const CLARIFICATION_OPTIONS = [
  { id: 'proceed', description: 'コード側の判定で、このまま実行できる。' },
  { id: 'ask', description: 'コード側の判定で、ユーザーに一つ追加質問が必要である。' }
];
export const BINARY_OPTIONS = [
  { id: 'yes', description: 'はい。条件を満たしている。' },
  { id: 'no', description: 'いいえ。条件を満たしていない、または判断できない。' }
];
export const CONFIRMATION_REPLY_OPTIONS = [
  { id: 'approval', description: '承認を求める確認に対して、その条件で進めると受け入れている。未指定の値を「はい」だけで補ってはいない。' },
  { id: 'answer_to_requested_information', description: '確認質問で求められた未解決項目の値を、今回の返答で具体的に答えている。値そのものの存在・型・候補との照合はコード側で行う。' },
  { id: 'neither', description: '承認でも、要求された情報への具体的な回答でもない。取消・変更・別の新しい依頼は既存の分類に戻す。' }
];
export const CONFIRMATION_REPLY_QUESTION = 'confirmationPending が示す確認の目的、requiredItems、confirmedInfo、unresolvedItems、および今回の request を合わせ、今回の返答の意味を一つ選ぶ。approval は承認目的の確認を受け入れる返答、answer_to_requested_information は未解決項目に具体的な値を答える返答、neither はそのどちらでもない返答である。値の存在・型・候補一致・全項目充足はコード側で検証する。';

function selection(result, options) {
  const winner = uniqueWinner(result);
  return { winner: winner ?? 'unknown', uniqueWinner: winner !== null, result, options };
}

function binarySelection(result) {
  const selected = selection(result, BINARY_OPTIONS);
  return { ...selected, value: selected.uniqueWinner ? selected.winner === 'yes' : null };
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function normalizeText(value) { return value.normalize('NFKC').trim().replace(/\s+/gu, ' '); }

function cleanHistory(history) {
  if (!Array.isArray(history)) throw new TypeError('relatedHistory must be an array');
  return history.map((item, index) => {
    if (!isRecord(item) || typeof item.role !== 'string' || typeof item.content !== 'string') {
      throw new TypeError(`relatedHistory[${index}] must contain role and content`);
    }
    return { role: item.role, content: item.content };
  });
}

function validValue(value, type) {
  if (type === 'string') return typeof value === 'string' && value.trim().length > 0;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'date') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
  return false;
}

function candidateValue(candidate) { return isRecord(candidate) && hasOwn(candidate, 'value') ? candidate.value : candidate; }
function allowedValue(value, item) {
  if (!validValue(value, item.type)) return false;
  return !item.candidates.length || item.candidates.some((candidate) => Object.is(candidateValue(candidate), value));
}

function normalizeItem(item, index) {
  if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) throw new TypeError(`confirmationPending.requiredItems[${index}] is invalid`);
  if (!['string', 'number', 'integer', 'boolean', 'date'].includes(item.type)) throw new TypeError(`confirmationPending.requiredItems[${index}].type is unsupported`);
  if (item.candidates !== undefined && !Array.isArray(item.candidates)) throw new TypeError(`confirmationPending.requiredItems[${index}].candidates must be an array`);
  const candidates = (item.candidates ?? []).map(candidateValue);
  if (candidates.some((candidate) => !validValue(candidate, item.type))) throw new TypeError(`confirmationPending.requiredItems[${index}].candidates contain an invalid value`);
  return { id: item.id, label: typeof item.label === 'string' && item.label.trim() ? item.label : item.id, type: item.type, candidates };
}

function normalizePending(value) {
  if (value === null) return null;
  if (!isRecord(value)) throw new TypeError('confirmationPending must be an object or null');
  const requiredItemsProvided = Array.isArray(value.requiredItems);
  const confirmedInfoProvided = isRecord(value.confirmedInfo);
  const unresolvedItemsProvided = Array.isArray(value.unresolvedItems);
  const requiredItems = requiredItemsProvided ? value.requiredItems.map(normalizeItem) : [];
  const requiredIds = new Set(requiredItems.map((item) => item.id));
  const confirmedInfo = {};
  const rawConfirmedInfo = confirmedInfoProvided ? value.confirmedInfo : {};
  for (const item of requiredItems) if (hasOwn(rawConfirmedInfo, item.id) && allowedValue(rawConfirmedInfo[item.id], item)) confirmedInfo[item.id] = rawConfirmedInfo[item.id];
  const rawUnresolved = unresolvedItemsProvided ? value.unresolvedItems : requiredItems.map((item) => item.id).filter((id) => !hasOwn(confirmedInfo, id));
  const unresolvedItems = [...new Set(rawUnresolved.filter((id) => requiredIds.has(id)))];
  for (const item of requiredItems) if (!hasOwn(confirmedInfo, item.id) && !unresolvedItems.includes(item.id)) unresolvedItems.push(item.id);
  return {
    request: typeof value.request === 'string' ? value.request : '',
    question: typeof value.question === 'string' ? value.question : '',
    purpose: typeof value.purpose === 'string' ? value.purpose : null,
    requiredItems,
    confirmedInfo,
    unresolvedItems,
    stateComplete: Boolean(typeof value.request === 'string' && value.request.trim() && typeof value.question === 'string' && value.question.trim()
      && typeof value.purpose === 'string' && requiredItemsProvided && confirmedInfoProvided && unresolvedItemsProvided
      && rawUnresolved.every((id) => requiredIds.has(id)))
  };
}

export function buildInterpretationState({ request, relatedHistory = [], confirmationPending = null } = {}) {
  if (typeof request !== 'string' || !request.trim()) throw new TypeError('request must be a non-empty string');
  return { request, relatedHistory: cleanHistory(relatedHistory), confirmationPending: normalizePending(confirmationPending) };
}

function containsCandidate(reply, candidate) {
  const normalizedReply = normalizeText(reply);
  const normalizedCandidate = normalizeText(String(candidate));
  if (!normalizedCandidate) return false;
  let offset = normalizedReply.indexOf(normalizedCandidate);
  while (offset !== -1) {
    const before = normalizedReply[offset - 1] ?? '';
    const after = normalizedReply[offset + normalizedCandidate.length] ?? '';
    const ascii = (character) => /[A-Za-z0-9_]/u.test(character);
    if (!((ascii(normalizedCandidate[0]) && ascii(before)) || (ascii(normalizedCandidate.at(-1)) && ascii(after)))) return true;
    offset = normalizedReply.indexOf(normalizedCandidate, offset + 1);
  }
  return false;
}

function valuesFromReply(reply, pending) {
  const confirmedInfo = { ...pending.confirmedInfo };
  const unresolvedItems = [...pending.unresolvedItems];
  const itemById = new Map(pending.requiredItems.map((item) => [item.id, item]));
  const matchedItems = [];
  const ambiguousItems = [];
  const unavailableItems = [];
  for (const id of pending.unresolvedItems) {
    const item = itemById.get(id);
    const matches = item.candidates.filter((candidate) => containsCandidate(reply, candidate));
    if (matches.length === 1 && allowedValue(matches[0], item)) {
      confirmedInfo[id] = matches[0];
      unresolvedItems.splice(unresolvedItems.indexOf(id), 1);
      matchedItems.push(id);
    } else if (matches.length > 1) ambiguousItems.push(id);
    else unavailableItems.push(id);
  }
  return { confirmedInfo, unresolvedItems, matchedItems, ambiguousItems, unavailableItems };
}

function resolveConfirmation(state, reply, relation) {
  const pending = state.confirmationPending;
  if (!pending) return null;
  const values = reply.winner === 'answer_to_requested_information'
    ? valuesFromReply(state.request, pending)
    : { confirmedInfo: { ...pending.confirmedInfo }, unresolvedItems: [...pending.unresolvedItems], matchedItems: [], ambiguousItems: [], unavailableItems: [] };
  const validApproval = reply.winner === 'approval' && pending.stateComplete && pending.purpose === 'approval' && values.unresolvedItems.length === 0;
  const validAnswer = reply.winner === 'answer_to_requested_information' && pending.stateComplete && pending.purpose === 'collect_missing_values' && values.unresolvedItems.length === 0;
  const route = reply.winner === 'neither' && relation.winner !== 'confirmation_reply' ? 'intent' : 'confirmation';
  const canProceed = validApproval || validAnswer;
  return { meaning: reply.winner, route, canProceed, stateComplete: pending.stateComplete, purpose: pending.purpose, confirmedInfo: values.confirmedInfo,
    unresolvedItems: values.unresolvedItems, matchedItems: values.matchedItems, ambiguousItems: values.ambiguousItems, unavailableItems: values.unavailableItems,
    nextPending: canProceed ? null : { ...pending, confirmedInfo: values.confirmedInfo, unresolvedItems: values.unresolvedItems } };
}

export async function interpretUserIntent({ bridge, request, relatedHistory = [], confirmationPending = null, onDecision = () => {} } = {}) {
  if (!bridge || typeof bridge.score !== 'function') throw new TypeError('bridge.score is required');
  const state = buildInterpretationState({ request, relatedHistory, confirmationPending });
  const score = async (operation, question, options) => {
    const result = await bridge.score({ state, question, options });
    const selected = options === BINARY_OPTIONS ? binarySelection(result) : selection(result, options);
    onDecision({ operation, state, question, options, ...selected });
    return selected;
  };
  const relation = await score('intent_relation', 'この自然文の依頼が会話の中でどのような関係にあるかを一つ選ぶ。情報の種類ではなく、依頼と会話履歴の関係だけを判断する。対象・期間・ID・処理内容などが明記された新しい依頼は new_request。確認の取消・変更・別依頼は confirmation_reply にしない。', RELATION_OPTIONS);
  const action = await score('intent_action', 'この自然文で実行してほしい操作を一つ選ぶ。条件を追加して検索・一覧化する依頼は find_or_list、特定対象の内容を確認する依頼は inspect_detail、確認に同意する返答は confirm_or_proceed、不足情報を具体的に答える返答は provide_missing_value とする。', ACTION_OPTIONS);
  const explicitTarget = await score('intent_explicit_target', 'request に対象名、期間、識別子、または具体的な対象範囲が明記されているかを判断する。relatedHistory と confirmationPending はこの判断に使わない。', BINARY_OPTIONS);
  const reference = await score('intent_resolved_reference', 'relatedHistory または confirmationPending を参照すると、request が指す対象や条件を一つに特定できるかを判断する。', BINARY_OPTIONS);
  let confirmationReply = null;
  let confirmationResolution = null;
  if (state.confirmationPending) {
    confirmationReply = await score('confirmation_reply', CONFIRMATION_REPLY_QUESTION, CONFIRMATION_REPLY_OPTIONS);
    confirmationResolution = resolveConfirmation(state, confirmationReply, relation);
  }
  const competing = await score('intent_competing_interpretations', 'request と会話履歴を合わせたとき、表示済み結果への追加質問と新しい対象を探す依頼の両方が自然に成り立つかを判断する。', BINARY_OPTIONS);
  const hasKnownAction = action.uniqueWinner && action.winner !== 'unknown';
  const confirmationRoutesToIntent = Boolean(state.confirmationPending && confirmationResolution?.route === 'intent');
  const isConfirmation = Boolean((state.confirmationPending && confirmationResolution?.route === 'confirmation' && confirmationResolution.canProceed)
    || (!state.confirmationPending && relation.winner === 'confirmation_reply'));
  const isCorrection = relation.winner === 'correction_or_refinement' && hasKnownAction;
  const hasTarget = explicitTarget.value === true || (!confirmationRoutesToIntent && reference.value === true);
  const normalNeedsClarification = !isConfirmation && !isCorrection && (!hasKnownAction || competing.value !== false || !hasTarget);
  const confirmationNeedsClarification = Boolean(state.confirmationPending && confirmationResolution?.route === 'confirmation' && !confirmationResolution.canProceed);
  const requiresClarification = confirmationNeedsClarification || (confirmationRoutesToIntent ? normalNeedsClarification : !state.confirmationPending && normalNeedsClarification);
  const clarification = { winner: requiresClarification ? 'ask' : 'proceed', uniqueWinner: true, result: { derived: true, probabilities: [] }, options: CLARIFICATION_OPTIONS,
    derivedFrom: { explicitTarget, reference, competing, hasKnownAction, isConfirmation, isCorrection, hasTarget, confirmationRoutesToIntent, confirmationReply, confirmationResolution } };
  onDecision({ operation: 'clarification_gate', state, ...clarification });
  return { relation: relation.winner, relationScore: relation, action: action.winner, actionScore: action, goal: action.winner, goalScore: action,
    clarification, confirmationReply, confirmationResolution, requiresClarification,
    stateShape: { relatedHistoryCount: state.relatedHistory.length, hasConfirmationPending: Boolean(state.confirmationPending), hasStructuredConfirmationState: Boolean(state.confirmationPending?.stateComplete), clarificationDerivedInCode: true } };
}
