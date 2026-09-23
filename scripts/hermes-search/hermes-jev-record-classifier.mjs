import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { createTypesafeDirectEvaluate } from './hermes-jev-record-pilot.mjs';
import { nonconformityDefinition } from './hermes-source-definition.mjs';
import {
  applySearchDelta,
  deltaFingerprint,
  emptySearchState,
  exactSearchArguments,
  hasSemanticConditions,
  searchStateSummary,
  stateFingerprint,
  validateSearchState,
} from './hermes-search-state.mjs';
import {
  evaluateAmbiguityImpact,
  RESOLUTION_ACTIONS,
} from './hermes-resolution-policy.mjs';

export const CLASSIFIER_SCHEMA = 'hermes-jev-record-classification/v2';
export const CLASSIFIER_DEFINITION_VERSION = 4;
const PREVIOUS_CLASSIFIER_DEFINITION_VERSION = 3;
const SOURCE_FIELDS = Object.freeze({ ...nonconformityDefinition.metadataFields, ...nonconformityDefinition.bodyFields });

const QUERY_NONE = '__none_requested__';
const QUERY_DECISION_POLICY = Object.freeze({
  // Inclusion is read-only retrieval, so a plausible positive is retained as
  // a candidate. Exclusion is stricter because an ambiguous negative must not
  // be presented as proven absence.
  includeAt: 0.6,
  excludeAt: 0.75,
  uncertainFrom: 0.35,
});
const QUERY_CHOICE_POLICY = Object.freeze({ uncertainBelow: 0.5 });
const RECORD_CHOICE_POLICY = Object.freeze({ candidateAt: 0.2 });
const RECORD_NOUL_POLICY = Object.freeze({
  definiteYesAt: 0.5,
  candidateAt: 0.2,
  uncertainFrom: 0.35,
});

const DISPLAY_REQUESTS = Object.freeze([
  ['originalText', '記録の原文または記載内容そのものを表示する要求'],
  ['discoveredOn', '発生日・発見日・日付を表示する要求'],
  ['process', '工程を表示する要求'],
  ['phenomenon', '現象・不適合内容を表示する要求'],
  ['treatment', '処置・対応・是正内容を表示する要求'],
  ['cause', '原因を表示する要求'],
  ['identifiers', '不適合番号・品番など識別情報を表示する要求'],
]);

const GROUPS = Object.freeze([
  {
    id: 'process', cardinality: 'single', label: '工程', options: [
      ['turning', '旋盤加工'], ['milling', 'フライス加工'], ['grinding', '研削加工'],
      ['inspection', '検査工程'], ['assembly', '組立工程'], ['other_recorded', '本文に記載されたその他の工程'],
      ['unknown', '本文から工程を特定できない']
    ]
  },
  {
    id: 'phenomenon', cardinality: 'multiple', label: '現象', options: [
      ['position_error', '位置・ピッチ・ずれの不適合'], ['surface_damage', '傷・打痕・へこみなどの表面損傷'],
      ['missing_marking', '刻印・表示・識別情報の欠落'], ['crack_or_breakage', '割れ・破損・欠け'],
      ['other_recorded', '本文に記載されたその他の現象']
    ]
  },
  {
    id: 'dimension_direction', cardinality: 'single', label: '寸法・形状の大小方向', options: [
      ['oversize', '基準値・指定値より大きい、規格または上限を超えている'],
      ['undersize', '基準値・指定値より小さい、規格または下限を下回っている'],
      ['not_applicable', '寸法・形状の大小方向を判定する記載がない'],
      ['unknown', '寸法・形状に関する記載はあるが、大小方向を確定できない']
    ]
  },
  {
    id: 'treatment', cardinality: 'multiple', label: '処置・対応', options: [
      ['rework', '再加工・手直しを実施'], ['segregate', '選別・隔離を実施'],
      ['repair_or_replace', '修理・交換・再製作を実施'], ['inspection_or_confirmation', '検査・確認・精度調整を実施'],
      ['design_consultation', '設計・技術部門へ確認または相談'], ['other_recorded', '本文に記載されたその他の処置・対応']
    ]
  },
  {
    id: 'cause', cardinality: 'multiple', label: '原因', options: [
      ['tool_wear', '工具・刃具の摩耗または状態'], ['equipment_failure', '設備・機械の不具合'],
      ['confirmation_insufficient', '確認・測定・作業手順の不足'], ['material_or_part', '材料・部品・支給品の状態'],
      ['other_recorded', '本文に記載されたその他の原因']
    ]
  },
  {
    id: 'impact', cardinality: 'multiple', label: '影響・対象', options: [
      ['dimension', '寸法・公差への影響'], ['appearance', '外観・表面状態への影響'],
      ['function', '機能・性能への影響'], ['identification', '刻印・表示・識別への影響'],
      ['other_recorded', '本文に記載されたその他の影響']
    ]
  },
  {
    id: 'cause_status', cardinality: 'single', label: '原因の記録状態', options: [
      ['cause_recorded', '原因が本文に明記されている'], ['cause_not_recorded', '原因が本文に記載されていない'],
      ['unknown', '本文から原因の記録状態を確定できない']
    ]
  },
  {
    id: 'treatment_status', cardinality: 'single', label: '処置の記録状態', options: [
      ['treatment_recorded', '処置または対応が本文に明記されている'], ['treatment_not_recorded', '処置または対応が本文に記載されていない'],
      ['unknown', '本文から処置の記録状態を確定できない']
    ]
  }
]);

const STOP_WORDS = new Set(['について', '確認', 'したい', '探して', '検索', '記録', '不適合', '最近', '最新', '直近', '原文', '内容', '発生', '発生日', '教えて', 'ください', '除く', '除外', '以外', 'の', 'を', 'が', 'は', 'で', 'に', 'へ', 'と', 'や', 'も']);
const ORGANIZATION_UNITS = Object.freeze(['工場', '本社', '事業所', 'センター', '研究所', '部', '課', '係', '室', '班']);
const ORGANIZATION_FACILITY_UNITS = new Set(['工場', '本社', '事業所', 'センター', '研究所']);
const OBSERVED_TOPIC_EXCLUDED_FIELDS = new Set([
  'id', 'kind', 'nonconformityNo', 'partNumber', 'partName', 'machineName', 'originDepartmentCode',
  'originDepartmentName', 'originDepartmentMeaning', 'evidenceKey', 'discoveredOn', 'sourceVersionDate',
  'sourceUpdatedOn', 'lastEvaluatedIngestRunId', 'lastSnapshotReceivedAt', 'provenance', 'rawText', 'sourceContentSha256'
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return null;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function rawText(record) {
  const fields = Object.entries(SOURCE_FIELDS).map(([field, label]) => [label, record[field]]);
  return fields.filter(([, value]) => text(value)).map(([label, value]) => `${label}: ${text(value)}`).join('\n');
}

function sourceRecord(record) {
  if (!isObject(record) || typeof record.id !== 'string' || !record.id) throw new Error('invalid nonconformity source record');
  return {
    ...record,
    rawText: text(record.rawText) || rawText(record),
    sourceContentSha256: sha256(canonicalJson(record))
  };
}

function optionsFor(group) {
  return group.options.map((option) => Array.isArray(option) ? { id: option[0], description: option[1] } : option);
}

function choiceQuestion(instructions, options) {
  return {
    type: 'choice',
    instructions,
    criteria: Object.fromEntries(options.map((option) => [option.id, option.description])),
  };
}

function noulQuestion(instructions, trueDescription, falseDescription) {
  return {
    type: 'noul',
    instructions,
    criteria: { true: trueDescription, false: falseDescription },
  };
}

function singleChoiceInstructions(group, mode) {
  if (group.id === 'dimension_direction') {
    return mode === 'record'
      ? '記録本文の寸法・形状の大小方向を一つ選ぶ。基準値・指定値より大きい、上限超過、過大は oversize、基準値・指定値より小さい、下限未満、不足は undersize とする。寸法の大小方向に関する記載がなければ not_applicable、寸法に関係するが大小方向を確定できない、または記載が矛盾する場合は unknown とする。本文にない数値や方向を補わず、oversize と undersize を同時に選ばない。'
      : `ユーザーの検索要求が、寸法・形状の大小方向を単一の絞り込み条件として指定している場合だけ選ぶ。上限超過・基準値より大きい・過大は oversize、下限未満・指定値より小さい・不足は undersize とする。表示するだけ、大小方向の指定がない、または本文からの推測にとどまる場合は ${QUERY_NONE} を選ぶ。oversize と undersize を同時に条件化しない。`;
  }
  return mode === 'record'
    ? `記録本文に記載された${group.label}を一つ選ぶ。本文にない原因・処置・工程を補わず、特定できない場合だけ unknown を選ぶ。`
    : `ユーザーの検索要求が、${group.label}を単一の絞り込み条件として指定している場合はその値を一つ選ぶ。指定がない、表示するだけ、または本文からの推測にとどまる場合は ${QUERY_NONE} を選ぶ。`;
}

function buildRecordQuestions(definition) {
  const questions = {};
  for (const group of definition.groups) {
    const options = optionsFor(group);
    if (group.cardinality === 'single') {
      questions[group.id] = choiceQuestion(
        singleChoiceInstructions(group, 'record'),
        options,
      );
      continue;
    }
    for (const { id, description } of options) {
      questions[`${group.id}:${id}`] = noulQuestion(
        `記録本文に、${group.label}として「${description}」が明記または明確に示されているか判定する。単に関連しそうという理由では yes にせず、記載がない場合は no とする。`,
        `本文に該当する${group.label}の内容が明記または明確に示されている。`,
        `本文に該当する${group.label}の内容がない、または記載だけでは判断できない。`,
      );
    }
  }
  return questions;
}

function buildQueryQuestions(definition, removalCandidates = [], fieldMentions = []) {
  const questions = {};
  for (const group of definition.groups) {
    const options = optionsFor(group);
    if (group.cardinality === 'single') {
      questions[group.id] = choiceQuestion(
        singleChoiceInstructions(group, 'query'),
        [{ id: QUERY_NONE, description: `${group.label}を検索条件として指定していない` }, ...options],
      );
      continue;
    }
    for (const { id, description } of options) {
      questions[`include:${group.id}:${id}`] = noulQuestion(
        `ユーザーの検索要求は、${group.label}として「${description}」に該当する記録を含める条件を指定しているか。表示要求や単なる話題ではなく、検索対象を絞る条件として判定する。`,
        `該当する${group.label}の記録を検索結果に含める条件が指定されている。`,
        `その${group.label}を含める検索条件は指定されていない。`,
      );
      questions[`exclude:${group.id}:${id}`] = noulQuestion(
        `ユーザーの検索要求は、${group.label}として「${description}」に該当する記録を除外する条件を指定しているか。「除く」「以外」などの否定条件だけを判定し、通常の含める条件とは分ける。`,
        `該当する${group.label}の記録を検索結果から除外する条件が指定されている。`,
        `その${group.label}を除外する条件は指定されていない。`,
      );
    }
  }
  for (const [id, description] of DISPLAY_REQUESTS) {
    questions[`display:${id}`] = noulQuestion(
      `ユーザーは検索結果で「${description}」を表示することを求めているか。これは検索対象を絞る条件ではなく、表示要求として判定する。`,
      `その表示内容が要求されている。`,
      `その表示内容は要求されていない。`,
    );
  }
  questions.conversation_target = choiceQuestion(
    'このメッセージが、会話状態に示された前回の検索対象への追加質問・確認回答か、新しい検索要求かを選ぶ。前回の対象を勝手に変更しない。',
    [
      { id: 'same_target', description: '前回の検索結果または確認待ちの対象を引き継ぐ' },
      { id: 'new_search', description: '前回とは別の検索を開始する' },
      { id: 'no_prior_target', description: '前回の検索対象がない' },
    ],
  );
  questions.change_action = choiceQuestion(
    '前回の確定条件に対するこのメッセージの操作を選ぶ。条件への言及、同じ値の再指定、実際の変更を区別する。同じ条件の再指定は変更ではない。件数・並び順だけ変える要求は replace_condition。「表示」という語だけで update_display にしない。現在の確定条件に合わない検索結果が混ざったという指摘は、条件自体を変更・解除する指示と区別する。参照する既存条件と訂正意図が明確なら correct_condition、条件を追加・指定項目だけを置換・指定項目を解除・新規検索する指示ならそれぞれを選ぶ。前回の検索対象・条件・件数・並び順を変えず、その記録の項目や原文を表示するだけなら update_display を選ぶ。条件変更も含む要求は update_display ではなく該当する条件操作を選び、意味を確定できなければ clarify を選ぶ。',
    [
      { id: 'add_condition', description: '前回の条件を保持して条件を追加する' },
      { id: 'replace_condition', description: '指定された条件項目だけを置換する' },
      { id: 'remove_condition', description: '指定された条件項目を解除する' },
      { id: 'correct_condition', description: '前回の条件の誤りを訂正する' },
      { id: 'new_search', description: '前回とは別の検索を開始する' },
      { id: 'update_display', description: '前回の検索対象・条件・件数・並び順をすべて保持し、表示する項目だけを指定する。検索条件の追加・置換・解除ではない' },
      { id: 'clarify', description: '操作の意味を確定できないので確認する' },
    ],
  );
  if (removalCandidates.length) {
    questions.removal_target = choiceQuestion(
      'If `request` asks to remove a search condition, select exactly the CURRENT condition in `removalCandidates` that it refers to. The operation is judged separately. A factory/location scope and a department filter are different conditions even when their names occur together. Remove only the requested condition; keep every other condition. Select organization_all only when the user explicitly removes the whole organization scope, not just its factory or department. A whole-field/group candidate (including factory or department groups) removes every listed value: select it only for an explicit whole-field/group removal; select the individual value/polarity candidate for one condition. If no current candidate fits, several different conditions could be meant, or this is not a removal request, select __none_requested__. Do not infer a broader target from a narrower or unknown name.',
      [
        { id: QUERY_NONE, description: '解除する現在の条件を一つに特定できない、候補にない、または解除の要求ではない' },
        ...removalCandidates.map(({ id, label, values }) => ({ id, description: { condition: label, currentValues: values } })),
      ],
    );
  }
  for (const mention of fieldMentions) {
    questions[mention.id] = choiceQuestion(
      { question: 'In `request`, does this source span refer to a field to display/use, or specify an organization VALUE to filter by? Use the source field meaning and recorded value candidates; do not turn a display request into a filter. An unknown value explicitly supplied by the user is still condition_value, never a field_reference just because it is absent from candidates.', mention },
      [
        { id: 'field_reference', description: 'The span names or describes a source field, not a value restricting records.' },
        { id: 'condition_value', description: 'The span supplies an organization value, including an unknown value.' },
        { id: 'unresolved', description: 'Its role cannot be determined from the request and current conditions.' },
      ],
    );
  }
  return questions;
}

function buildQuestions(definition, mode, removalCandidates = [], fieldMentions = []) {
  return mode === 'record' ? buildRecordQuestions(definition) : buildQueryQuestions(definition, removalCandidates, fieldMentions);
}

function validProbability(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeChoiceJudgment(answer, options, label) {
  if (!isObject(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string') {
    throw new Error(`JEV returned invalid Choice answer for ${label}`);
  }
  const allowed = new Set(options.map((option) => option.id));
  if (!allowed.has(answer.choice)) throw new Error(`JEV returned unsupported Choice for ${label}`);
  if (!isObject(answer.probabilities) || options.some((option) => !validProbability(answer.probabilities[option.id]))) {
    throw new Error(`JEV returned incomplete Choice probabilities for ${label}`);
  }
  const probabilitySum = options.reduce((sum, option) => sum + answer.probabilities[option.id], 0);
  if (Math.abs(probabilitySum - 1) > 0.02) throw new Error(`JEV returned invalid Choice probability distribution for ${label}`);
  if (!validProbability(answer.confidence)) throw new Error(`JEV returned invalid Choice confidence for ${label}`);
  return {
    type: 'choice',
    choice: answer.choice,
    probabilities: Object.fromEntries(options.map((option) => [option.id, answer.probabilities[option.id]])),
    confidence: answer.confidence,
  };
}

function normalizeNoulJudgment(answer, label) {
  if (!isObject(answer) || answer.type !== 'noul' || !validProbability(answer.noul)) {
    throw new Error(`JEV returned invalid Noul answer for ${label}`);
  }
  return { type: 'noul', noul: answer.noul };
}

function recordNoulDecision(noul) {
  if (noul >= RECORD_NOUL_POLICY.definiteYesAt) return 'yes';
  if (noul >= RECORD_NOUL_POLICY.uncertainFrom) return 'uncertain';
  if (noul >= RECORD_NOUL_POLICY.candidateAt) return 'candidate';
  return 'no';
}

function queryNoulDecision(noul, polarity = 'include') {
  const acceptAt = polarity === 'exclude' ? QUERY_DECISION_POLICY.excludeAt : QUERY_DECISION_POLICY.includeAt;
  if (noul >= acceptAt) return 'yes';
  if (noul >= QUERY_DECISION_POLICY.uncertainFrom) return 'uncertain';
  return 'no';
}

function queryOptionMayBeMentioned(question, option) {
  const source = `${option.description ?? ''} ${option.observedTerm ?? ''}`
    .normalize('NFKC')
    .replace(/[「」『』【】（）()［］[\]、。！？!?：:;,，．/]/g, ' ');
  const terms = source.split(/\s+/u).filter((term) => Array.from(term).length >= 2 && !STOP_WORDS.has(term));
  return terms.some((term) => question.normalize('NFKC').includes(term));
}

function displayRequestFrom(question, judgments) {
  const requested = new Set();
  for (const [id] of DISPLAY_REQUESTS) {
    const judgment = judgments[`display:${id}`];
    if (judgment?.type === 'noul' && judgment.noul >= QUERY_DECISION_POLICY.includeAt) requested.add(id);
  }
  const normalized = question.normalize('NFKC');
  if (/原文|原記録|記載内容|内容そのもの/u.test(normalized)) requested.add('originalText');
  if (/発生日|発見日|日付|いつ|年月日/u.test(normalized)) requested.add('discoveredOn');
  if (/工程/u.test(normalized)) requested.add('process');
  if (/現象|不適合内容|不具合|状況/u.test(normalized)) requested.add('phenomenon');
  if (/処置|処理|手直し|是正|対応/u.test(normalized)) requested.add('treatment');
  if (/原因/u.test(normalized)) requested.add('cause');
  if (/不適合番号|記録番号|品番|識別/u.test(normalized)) requested.add('identifiers');
  return { originalText: true, requested: [...requested] };
}

function queryClassificationFromAnswers(answers, definition, question) {
  const classification = {};
  const judgments = {};
  const include = {};
  const exclude = {};
  const unresolved = [];
  for (const group of definition.groups) {
    const options = optionsFor(group);
    if (group.cardinality === 'single') {
      const judgment = normalizeChoiceJudgment(answers[group.id], [{ id: QUERY_NONE, description: '指定なし' }, ...options], group.id);
      judgments[group.id] = judgment;
      classification[group.id] = judgment.choice === QUERY_NONE ? 'unspecified' : judgment.choice;
      if (judgment.choice !== QUERY_NONE) include[group.id] = judgment.choice;
      if (judgment.choice !== QUERY_NONE && judgment.confidence < QUERY_CHOICE_POLICY.uncertainBelow && queryOptionMayBeMentioned(question, options.find((option) => option.id === judgment.choice) ?? {})) {
        unresolved.push({ kind: 'include', groupId: group.id, optionId: judgment.choice, reason: 'Choice confidence is low' });
      }
      continue;
    }
    const selected = [];
    const excluded = [];
    for (const option of options) {
      const includeKey = `include:${group.id}:${option.id}`;
      const excludeKey = `exclude:${group.id}:${option.id}`;
      const includeJudgment = normalizeNoulJudgment(answers[includeKey], includeKey);
      const excludeJudgment = normalizeNoulJudgment(answers[excludeKey], excludeKey);
      judgments[includeKey] = includeJudgment;
      judgments[excludeKey] = excludeJudgment;
      const includeDecision = queryNoulDecision(includeJudgment.noul, 'include');
      const excludeDecision = queryNoulDecision(excludeJudgment.noul, 'exclude');
      if (includeDecision === 'yes') selected.push(option.id);
      if (excludeDecision === 'yes') excluded.push(option.id);
      if (includeDecision === 'uncertain' && queryOptionMayBeMentioned(question, option)) {
        unresolved.push({ kind: 'include', groupId: group.id, optionId: option.id, reason: 'Noul include probability is ambiguous' });
      }
      if (excludeDecision === 'uncertain' && queryOptionMayBeMentioned(question, option)) {
        unresolved.push({ kind: 'exclude', groupId: group.id, optionId: option.id, reason: 'Noul exclude probability is ambiguous' });
      }
    }
    classification[group.id] = selected;
    if (selected.length) include[group.id] = selected;
    if (excluded.length) exclude[group.id] = excluded;
  }
  const conversationTarget = normalizeChoiceJudgment(answers.conversation_target, [
    { id: 'same_target', description: '前回対象' },
    { id: 'new_search', description: '新規検索' },
    { id: 'no_prior_target', description: '前回対象なし' },
  ], 'conversation_target');
  judgments.conversation_target = conversationTarget;
  const changeAction = normalizeChoiceJudgment(answers.change_action, [
    { id: 'add_condition', description: '前回条件への追加' },
    { id: 'replace_condition', description: '指定項目の置換' },
    { id: 'remove_condition', description: '指定項目の解除' },
    { id: 'correct_condition', description: '前回条件の訂正' },
    { id: 'new_search', description: '新規検索' },
    { id: 'update_display', description: '検索条件を保持して表示項目だけを指定' },
    { id: 'clarify', description: '意味不確定' },
  ], 'change_action');
  judgments.change_action = changeAction;
  if (changeAction.choice === 'update_display') for (const [id] of DISPLAY_REQUESTS) {
    const key = `display:${id}`;
    judgments[key] = normalizeNoulJudgment(answers[key], key);
  }
  const display = displayRequestFrom(question, answers);
  for (const [id] of DISPLAY_REQUESTS) {
    const judgment = judgments[`display:${id}`];
    if (judgment?.type === 'noul' && judgment.noul >= QUERY_DECISION_POLICY.uncertainFrom && judgment.noul < QUERY_DECISION_POLICY.includeAt) {
      // Display ambiguity does not change the record set. Keep it for the
      // caller, but do not turn it into an unresolved search condition.
      display.uncertain = [...(display.uncertain ?? []), id];
    }
  }
  return {
    classification,
    judgments,
    query: { include, exclude, display, unresolved, conversationTarget: conversationTarget.choice, changeAction: changeAction.choice },
  };
}

function recordClassificationFromAnswers(answers, definition) {
  if (!isObject(answers)) throw new Error('JEV response has no answers');
  const classification = {};
  const judgments = {};
  for (const group of definition.groups) {
    const options = optionsFor(group);
    if (group.cardinality === 'single') {
      const judgment = normalizeChoiceJudgment(answers[group.id], options, group.id);
      judgments[group.id] = judgment;
      classification[group.id] = judgment.choice;
      continue;
    }
    const selected = [];
    for (const option of options) {
      const key = `${group.id}:${option.id}`;
      const judgment = normalizeNoulJudgment(answers[key], key);
      judgments[key] = { ...judgment, decision: recordNoulDecision(judgment.noul) };
      if (judgments[key].decision === 'yes') selected.push(option.id);
    }
    classification[group.id] = selected;
  }
  return { classification, judgments };
}

function classificationFromAnswers(answers, definition, mode, question) {
  return mode === 'record'
    ? recordClassificationFromAnswers(answers, definition)
    : queryClassificationFromAnswers(answers, definition, question);
}

function observedFields(records) {
  const fields = new Set();
  for (const record of records) for (const [key, value] of Object.entries(record)) {
    if (['rawText', 'sourceContentSha256'].includes(key)) continue;
    if (text(value)) fields.add(key);
  }
  return [...fields].sort();
}

function observedTopicOptions(records) {
  const counts = new Map();
  const labels = new Set(Object.values(SOURCE_FIELDS));
  const segmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
  for (const record of records) {
    const values = Object.entries(record)
      .filter(([key]) => !OBSERVED_TOPIC_EXCLUDED_FIELDS.has(key))
      .map(([, value]) => text(value)).filter(Boolean);
    const terms = new Set();
    for (const value of values) {
      const normalized = value.normalize('NFKC').replace(/[「」『』【】（）()［］[\]、。！？!?：:;,，．\n]/g, ' ');
      if (segmenter) {
        let run = '';
        const flush = () => {
          const candidate = run.trim();
          if (Array.from(candidate).length >= 2 && !STOP_WORDS.has(candidate) && !labels.has(candidate)) terms.add(candidate);
          run = '';
        };
        for (const segment of segmenter.segment(normalized)) {
          if (!segment.isWordLike) { flush(); continue; }
          run += segment.segment;
          const token = segment.segment.trim();
          if (token.length >= 2 && !STOP_WORDS.has(token) && !labels.has(token)) terms.add(token);
        }
        flush();
      } else {
        for (const candidate of normalized.split(/\s+/u)) if (Array.from(candidate).length >= 2 && !STOP_WORDS.has(candidate)) terms.add(candidate);
      }
    }
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0]))
    .slice(0, 32)
    .map(([term, count], index) => ({ id: `topic_${index + 1}`, description: `実データ本文に現れる検索テーマ「${term}」（${count}件）`, observedTerm: term }));
}

export function buildClassificationDefinition(records, previousDefinition = null) {
  const normalized = records.map(sourceRecord);
  const observedTopics = mergeObservedTopicOptions(observedTopicOptions(normalized), previousDefinition?.groups
    ?.find((group) => group.id === 'observed_topic')?.options);
  return {
    schema: 'hermes-classification-definition/v1',
    version: CLASSIFIER_DEFINITION_VERSION,
    groups: [
      ...GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        cardinality: group.cardinality,
        questionType: group.cardinality === 'single' ? 'choice' : 'noul',
        recordPolicy: group.cardinality === 'multiple' ? RECORD_NOUL_POLICY : null,
        queryPolicy: group.cardinality === 'multiple' ? QUERY_DECISION_POLICY : null,
        options: group.options.map(([id, description]) => ({ id, description })),
      })),
      {
        id: 'observed_topic',
        label: '実データに現れる検索テーマ',
        cardinality: 'multiple',
        questionType: 'noul',
        recordPolicy: RECORD_NOUL_POLICY,
        queryPolicy: QUERY_DECISION_POLICY,
        options: observedTopics,
      }
    ],
    exactFields: ['nonconformityNo', 'partNumber', 'partName', 'machineName', 'originDepartmentCode', 'originDepartmentName', 'discoveredOn'],
    observedFields: observedFields(normalized),
    source: 'active ScawStfutekigoCurrent records',
    draftPolicy: 'semantic groups are reviewed against observed fields; exact identifiers and dates remain code-owned',
  };
}

function mergeObservedTopicOptions(currentOptions, previousOptions = []) {
  const currentByTerm = new Map(currentOptions.map((option) => [option.observedTerm, option]));
  const merged = [];
  const seen = new Set();
  for (const previous of Array.isArray(previousOptions) ? previousOptions : []) {
    if (!isObject(previous) || typeof previous.observedTerm !== 'string' || seen.has(previous.observedTerm)) continue;
    const current = currentByTerm.get(previous.observedTerm);
    merged.push({ ...(current ?? previous), id: previous.id });
    seen.add(previous.observedTerm);
  }
  let nextId = merged.reduce((maximum, option) => {
    const number = /^topic_(\d+)$/.exec(option.id ?? '')?.[1];
    return Math.max(maximum, number ? Number(number) : 0);
  }, 0) + 1;
  for (const current of currentOptions) {
    if (seen.has(current.observedTerm)) continue;
    merged.push({ ...current, id: `topic_${nextId}` });
    nextId += 1;
  }
  return merged;
}

export function definitionHash(definition) {
  return sha256(canonicalJson(definition));
}

function normalizeSnapshot(snapshot) {
  if (!isObject(snapshot) || !Array.isArray(snapshot.records) || snapshot.records.length === 0) throw new Error('active nonconformity snapshot is missing or empty');
  return snapshot.records.map((record) => sourceRecord(record));
}

async function readSnapshot(snapshotPath) {
  return normalizeSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')));
}

async function readStore(storePath) {
  try {
    const value = JSON.parse(await readFile(storePath, 'utf8'));
    return isObject(value) && value.schema === CLASSIFIER_SCHEMA && Array.isArray(value.records) && Array.isArray(value.classifications) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeStore(storePath, value) {
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temporary = `${storePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, storePath);
}

const LEGACY_DIMENSION_OPTION_IDS = new Set(['oversize', 'undersize']);

function legacyDimensionDirection(value) {
  const classification = value?.classification;
  const judgments = value?.judgments;
  if (!isObject(classification) || !isObject(judgments) || !Array.isArray(classification.phenomenon)) return null;
  const legacy = [...LEGACY_DIMENSION_OPTION_IDS].map((optionId) => ({
    optionId,
    selected: classification.phenomenon.includes(optionId),
    judgment: judgments[`phenomenon:${optionId}`],
  }));
  if (legacy.some(({ judgment }) => !isObject(judgment) || judgment.type !== 'noul' || !validProbability(judgment.noul))) return null;
  const judged = legacy.map((entry) => ({ ...entry, decision: recordNoulDecision(entry.judgment.noul) }));
  // The old multi-tag result is reusable only when its selected tags agree
  // with the stored probabilities and both sides are definite. A tag that
  // contradicts its probability is not evidence for either direction.
  if (judged.some(({ selected, decision }) => selected !== (decision === 'yes'))) return null;
  if (judged.some(({ decision }) => !['yes', 'no'].includes(decision))) return null;
  const yes = judged.filter(({ decision }) => decision === 'yes');
  if (yes.length > 1) return null;
  if (yes.length === 1) return {
    choice: yes[0].optionId,
    judgment: { type: 'choice', choice: yes[0].optionId, source: 'legacy_noul_migration' },
  };
  return {
    choice: 'not_applicable',
    judgment: { type: 'choice', choice: 'not_applicable', source: 'legacy_noul_migration' },
  };
}

function compatibleSavedGroup(savedGroup, currentGroup) {
  if (!isObject(savedGroup)) return false;
  if (currentGroup.id === 'phenomenon') {
    const removeLegacy = (group) => ({
      ...group,
      options: (group.options ?? []).filter((option) => !LEGACY_DIMENSION_OPTION_IDS.has(option?.id)),
    });
    return canonicalJson(removeLegacy(savedGroup)) === canonicalJson(removeLegacy(currentGroup));
  }
  return canonicalJson(savedGroup) === canonicalJson(currentGroup);
}

function reusableClassification(value, savedDefinition, definition) {
  if (!isObject(value) || !isObject(value.classification) || !isObject(value.judgments) || !isObject(savedDefinition)) return null;
  if (![PREVIOUS_CLASSIFIER_DEFINITION_VERSION, definition.version].includes(savedDefinition.version)) return null;
  const savedGroups = new Map(Array.isArray(savedDefinition.groups) ? savedDefinition.groups.map((group) => [group.id, group]) : []);
  for (const group of definition.groups) {
    const savedGroup = savedGroups.get(group.id);
    if (group.id === 'dimension_direction' && !savedGroup) continue;
    if (group.id !== 'observed_topic' && !compatibleSavedGroup(savedGroup, group)) return null;
    if (group.id === 'observed_topic') {
      if (!isObject(savedGroup) || savedGroup.cardinality !== group.cardinality) return null;
      const savedOptionIds = new Set((savedGroup.options ?? []).map((option) => option?.id).filter(Boolean));
      const currentOptionIds = new Set((group.options ?? []).map((option) => option?.id).filter(Boolean));
      // A new observed topic changes the meaning of an existing row's
      // multi-tag result. Treat that row as pending instead of silently
      // reusing a classification that cannot answer the new topic.
      if ([...currentOptionIds].some((id) => !savedOptionIds.has(id))) return null;
    }
  }
  const normalized = {};
  const judgments = {};
  const migratedDimension = !Object.hasOwn(value.classification, 'dimension_direction') ? legacyDimensionDirection(value) : null;
  if (!Object.hasOwn(value.classification, 'dimension_direction') && !migratedDimension) return null;
  for (const group of definition.groups) {
    const candidate = group.id === 'dimension_direction'
      ? (migratedDimension?.choice ?? value.classification[group.id])
      : value.classification[group.id];
    const allowed = new Set(group.options.map((option) => option.id));
    if (group.cardinality === 'single') {
      if (!allowed.has(candidate)) return null;
      normalized[group.id] = candidate;
      const judgment = group.id === 'dimension_direction' && migratedDimension
        ? migratedDimension.judgment
        : value.judgments[group.id];
      if (group.id === 'dimension_direction' && migratedDimension) {
        judgments[group.id] = judgment;
        continue;
      }
      try { judgments[group.id] = normalizeChoiceJudgment(judgment, optionsFor(group), group.id); } catch { return null; }
    } else {
      if (!Array.isArray(candidate)) return null;
      const filteredCandidate = candidate.filter((item) => allowed.has(item));
      if (filteredCandidate.length !== candidate.filter((item) => !LEGACY_DIMENSION_OPTION_IDS.has(item)).length) return null;
      normalized[group.id] = filteredCandidate;
      for (const option of optionsFor(group)) {
        const key = `${group.id}:${option.id}`;
        const judgment = value.judgments[key];
        try {
          const normalizedJudgment = normalizeNoulJudgment(judgment, key);
          judgments[key] = { ...normalizedJudgment, decision: recordNoulDecision(normalizedJudgment.noul) };
        } catch { return null; }
      }
    }
  }
  return { classification: normalized, judgments };
}

function questionTerms(question) {
  const normalized = question.normalize('NFKC').replace(/[「」『』【】（）()［］[\]、。！？!?：:;,，．]/g, ' ');
  const words = new Set();
  const add = (value) => {
    const item = value.trim();
    if (Array.from(item).length >= 2 && !STOP_WORDS.has(item)) words.add(item);
  };
  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    for (const segment of segmenter.segment(normalized)) if (segment.isWordLike) add(segment.segment);
  }
  for (const identifier of normalized.match(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g) ?? []) add(identifier);
  return [...words].sort((left, right) => right.length - left.length).slice(0, 16);
}

function normalizedOrganizationValue(value) {
  return text(value).normalize('NFKC').replace(/[\s・\/\\_-]+/gu, '').toUpperCase();
}

function organizationTerms(value) {
  const normalized = text(value).normalize('NFKC');
  const terms = new Set([normalized]);
  const unitPattern = /(?:工場|本社|事業所|センター|研究所|部|課|係|室|班)/gu;
  let previousEnd = 0;
  for (const match of normalized.matchAll(unitPattern)) {
    const end = (match.index ?? 0) + match[0].length;
    const segment = normalized.slice(previousEnd, end).trim();
    const prefix = normalized.slice(0, end).trim();
    if (segment.length >= 2) terms.add(segment);
    if (prefix.length >= 2) terms.add(prefix);
    previousEnd = end;
  }
  return [...terms].filter((term) => normalizedOrganizationValue(term).length >= 2);
}

function isOrganizationTerm(term) {
  const normalized = normalizedOrganizationValue(term);
  return ORGANIZATION_UNITS.some((unit) => normalized.endsWith(normalizedOrganizationValue(unit))
    && normalized.length > normalizedOrganizationValue(unit).length);
}

function isOrganizationFacilityTerm(term) {
  const normalized = normalizedOrganizationValue(term);
  return [...ORGANIZATION_FACILITY_UNITS].some((unit) => normalized.endsWith(normalizedOrganizationValue(unit))
    && normalized.length > normalizedOrganizationValue(unit).length);
}

function embeddedOrganizationFacilityTerms(value) {
  return organizationTerms(value).filter((term) => isOrganizationFacilityTerm(term));
}

function organizationDepartmentTermsAfterFacility(value) {
  const terms = organizationTerms(value);
  const facilityTerms = terms.filter((term) => isOrganizationFacilityTerm(term));
  return terms.filter((term) => !isOrganizationFacilityTerm(term)
    && facilityTerms.every((facilityTerm) => !normalizedOrganizationValue(term).includes(normalizedOrganizationValue(facilityTerm))));
}

function previousOrganizationTermsAfterFacility(previousOrganization) {
  return [...new Set((previousOrganization?.matchedTerms ?? [])
    .flatMap((term) => organizationDepartmentTermsAfterFacility(term)))];
}

function sourceFieldHeadings() {
  return Object.entries(SOURCE_FIELDS).flatMap(([field, label]) =>
    [label, `${label}名`, `${label}欄`].map((heading) => ({ field, label, heading })));
}

function mentionedSourceHeadings(question) {
  const spans = text(question).normalize('NFKC').match(/[\p{Script=Han}\p{Script=Katakana}々ーA-Za-z0-9]+/gu) ?? [];
  return sourceFieldHeadings().filter(({ heading }) => spans.includes(heading));
}

function organizationQuestionInput(question, records, judgments = {}) {
  const normalized = text(question).normalize('NFKC');
  const values = organizationIndex(records);
  const knownTerms = new Set(values.flatMap((value) => value.terms.map(normalizedOrganizationValue)));
  const headings = sourceFieldHeadings();
  const mentions = [];
  const explicitTerms = [];
  const unresolved = [];
  const masked = normalized.replace(/[\p{Script=Han}\p{Script=Katakana}々ーA-Za-z0-9]+/gu, (span, offset) => {
    const sourceField = headings.find(({ heading }) => span.includes(heading));
    if (!sourceField || !questionOrganizationTerms(span).length || knownTerms.has(normalizedOrganizationValue(span))) return span;
    const isHeading = headings.some(({ heading }) => heading === span);
    const valuePosition = /(?:が|は|[:=])\s*[「『"]?$/u.test(normalized.slice(0, offset));
    if (isHeading && !valuePosition) return ' ';
    // A complete organization-shaped value is still resolved as a value, not
    // deleted because a source heading occurs inside it.
    if (!isHeading && isOrganizationTerm(span)) return span;
    const mention = {
      id: `field_mention:${mentions.length}`, span, offset,
      field: sourceField.field, meaning: sourceField.label,
      valueCandidates: values.map(({ name, code }) => ({ name, code })),
    };
    mentions.push(mention);
    const judgment = judgments[mention.id];
    if (judgment?.confidence >= QUERY_CHOICE_POLICY.uncertainBelow && judgment.choice === 'field_reference') return ' ';
    if (judgment?.confidence >= QUERY_CHOICE_POLICY.uncertainBelow && judgment.choice === 'condition_value') explicitTerms.push(span);
    else unresolved.push({ field: sourceField.field, term: span, reason: 'field_reference_unresolved' });
    return ' ';
  });
  return { masked, mentions, explicitTerms, unresolved };
}

function questionOrganizationTerms(question, explicitTerms = []) {
  const normalized = text(question).normalize('NFKC');
  const terms = new Set(explicitTerms);
  const pattern = /[\p{Script=Han}々ーA-Za-z0-9]{1,32}(?:工場|本社|事業所|センター|研究所|部|課|係|室|班)/gu;
  for (const match of normalized.matchAll(pattern)) {
    if (isOrganizationTerm(match[0])) terms.add(match[0]);
  }
  return [...terms];
}

function organizationTermIsExcluded(question, term) {
  const normalizedQuestion = normalizedOrganizationValue(question);
  const normalizedTerm = normalizedOrganizationValue(term);
  const index = normalizedQuestion.indexOf(normalizedTerm);
  if (index < 0) return false;
  const suffix = normalizedQuestion.slice(index + normalizedTerm.length, index + normalizedTerm.length + 4);
  return /^(?:を|は)?(?:除く|除外|以外)/u.test(suffix);
}

function organizationIndex(records) {
  const values = new Map();
  for (const record of records) {
    const name = text(record.originDepartmentName);
    if (!name) continue;
    const key = `${normalizedOrganizationValue(name)}\u0000${text(record.originDepartmentCode)}`;
    if (!values.has(key)) values.set(key, { name, code: text(record.originDepartmentCode) || null, terms: organizationTerms(name) });
  }
  return [...values.values()];
}

function resolveOrganizationConditions(question, records, previousOrganization = null, {
  ignorePreviousFacility = false,
  retainPreviousDepartment = false,
  fieldMentionJudgments = {},
} = {}) {
  const allCandidates = organizationIndex(records);
  const input = organizationQuestionInput(question, records, fieldMentionJudgments);
  const requestedQuestionTerms = questionOrganizationTerms(input.masked, input.explicitTerms);
  if (input.unresolved.length) return {
    include: [], exclude: [], unresolved: input.unresolved,
    resolution: evaluateAmbiguityImpact({ ambiguity: { reason: 'different_interpretations' } }),
  };
  const knownTerms = new Map();
  for (const candidate of allCandidates) {
    for (const term of candidate.terms) {
      const key = normalizedOrganizationValue(term);
      if (!isOrganizationTerm(term)) continue;
      const values = knownTerms.get(key) ?? [];
      if (!values.some((value) => value.name === candidate.name && value.code === candidate.code)) values.push(candidate);
      knownTerms.set(key, values);
    }
  }
  const previousFacilityTerms = ignorePreviousFacility ? [] : (previousOrganization?.matchedTerms ?? [])
    .filter((term) => isOrganizationFacilityTerm(term));
  const requestedFacilityTerms = ignorePreviousFacility
    ? []
    : requestedQuestionTerms.flatMap((term) => embeddedOrganizationFacilityTerms(term));
  const facilityScopeTerms = [...new Set(requestedFacilityTerms.length > 0 ? requestedFacilityTerms : previousFacilityTerms)];
  const requestedTerms = requestedQuestionTerms.length > 0
    ? retainPreviousDepartment
      ? [...new Set([
        ...previousOrganizationTermsAfterFacility(previousOrganization),
        ...requestedQuestionTerms.filter((term) => !isOrganizationFacilityTerm(term)),
      ])]
      : requestedQuestionTerms
    : retainPreviousDepartment
      ? previousOrganizationTermsAfterFacility(previousOrganization)
      : [];
  const requested = [...new Set(requestedTerms.map((term) => normalizedOrganizationValue(term)))]
    .map((term) => ({ term, values: knownTerms.get(term) ?? [] }))
    .filter(({ term, values }) => values.length > 0 || !requestedQuestionTerms.some((requestedTerm) => normalizedOrganizationValue(requestedTerm) === term))
    .sort((left, right) => right.term.length - left.term.length);
  const unknown = requestedQuestionTerms.find((term) => !knownTerms.has(normalizedOrganizationValue(term)));
  if (unknown) {
    return {
      include: [],
      exclude: [],
      unresolved: [{ field: 'originDepartmentName', term: unknown, reason: 'not_found' }],
      resolution: {
        action: RESOLUTION_ACTIONS.CONFIRM,
        reason: 'meaning_unresolved',
        ambiguityReason: 'not_found',
      },
    };
  }
  if (requested.length === 0) {
    return {
      include: [],
      exclude: [],
      unresolved: [],
      resolution: evaluateAmbiguityImpact(),
    };
  }

  const selectedTerms = requested.filter((item, index) => index === 0 || !requested.some((other, otherIndex) => otherIndex < index && other.term.includes(item.term)));
  const candidates = facilityScopeTerms.length > 0
    ? allCandidates.filter((candidate) => facilityScopeTerms.some((term) => candidate.terms.some((candidateTerm) => normalizedOrganizationValue(candidateTerm) === normalizedOrganizationValue(term))))
    : allCandidates;
  const nonFacilityTerms = selectedTerms.filter(({ term }) => !isOrganizationFacilityTerm(term));
  const selectedValues = candidates.filter((candidate) => nonFacilityTerms.every(({ term }) => candidate.terms.some((candidateTerm) => normalizedOrganizationValue(candidateTerm) === term)));
  const resolutionAssessments = nonFacilityTerms.map(({ term }) => {
    const values = selectedValues.filter((candidate) => candidate.terms.some((candidateTerm) => normalizedOrganizationValue(candidateTerm) === term));
    const ambiguity = values.length > 1 || previousFacilityTerms.length > 0
      ? { reason: 'candidate_set' }
      : null;
    const impact = evaluateAmbiguityImpact({
      ambiguity,
      candidateSetSafe: true,
      existingCondition: previousFacilityTerms.length > 0,
    });
    return { term, candidateCount: values.length, ...impact };
  });
  const confirmation = resolutionAssessments.find(({ action }) => action === RESOLUTION_ACTIONS.CONFIRM);
  if (confirmation) {
    return {
      include: [],
      exclude: [],
      unresolved: [{ field: 'originDepartmentName', term: confirmation.term, reason: confirmation.reason }],
      resolution: confirmation,
    };
  }
  const resolution = resolutionAssessments.find(({ action }) => action === RESOLUTION_ACTIONS.RESOLVE_EXISTING)
    ?? resolutionAssessments.find(({ action }) => action === RESOLUTION_ACTIONS.CONTINUE_SET)
    ?? evaluateAmbiguityImpact();
  const include = [];
  const exclude = [];
  for (const selected of selectedTerms) {
    const values = selectedValues.filter((candidate) => candidate.terms.some((candidateTerm) => normalizedOrganizationValue(candidateTerm) === selected.term));
    (organizationTermIsExcluded(question, selected.term) ? exclude : include).push(...values);
  }
  const unique = (values) => [...new Map(values.map((value) => [`${value.name}\u0000${value.code ?? ''}`, value])).values()];
  const includedTerms = [
    ...facilityScopeTerms.filter((term) => !organizationTermIsExcluded(question, term)),
    ...selectedTerms.filter(({ term }) => !organizationTermIsExcluded(question, term)).map(({ term }) => term),
  ];
  return {
    include: unique(include),
    exclude: unique(exclude),
    unresolved: [],
    resolution,
    // The values are the authorized set; matchedTerms preserves the compact
    // conditions for the live reader. Multiple values with the same formal
    // meaning are intentionally a union, not a Choice requiring confirmation.
    matchedTerms: [...new Set(includedTerms)],
  };
}

function firstMatch(question, records, field) {
  const candidates = [...new Set(records.map((record) => text(record[field])).filter(Boolean))].sort((left, right) => right.length - left.length);
  return candidates.find((value) => question.includes(value)) ?? null;
}

export function extractStructuredConditions(question, records, context = {}) {
  const result = {};
  const exclude = {};
  const normalized = question.normalize('NFKC');
  const organization = resolveOrganizationConditions(normalized, records, context.organization ?? null, {
    ignorePreviousFacility: context.ignorePreviousFacility === true,
    retainPreviousDepartment: context.retainPreviousDepartment === true,
    fieldMentionJudgments: context.fieldMentionJudgments,
  });
  const numbers = normalized.match(/(?:不適合|記録|番号)?\s*([0-9０-９]{4,})(?!\s*年)/u)?.[1];
  if (numbers) result.nonconformityNo = numbers.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  for (const field of ['partNumber', 'partName', 'machineName', 'originDepartmentCode']) {
    const match = firstMatch(normalized, records, field);
    if (match) {
      if (new RegExp(`${match}(?:を|は)?(?:除く|除外|以外)`).test(normalized)) exclude[field] = match;
      else result[field] = match;
    }
  }
  const date = normalized.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/u);
  if (date) result.discoveredOn = `${date[1]}-${String(date[2]).padStart(2, '0')}-${String(date[3]).padStart(2, '0')}`;
  return { include: result, exclude, organization, unresolved: organization.unresolved };
}

function displayOnlyRequest(question, conditions = {}, structured = {}) {
  return Object.keys(conditions).length === 0
    && !structured.organization?.include?.length
    && !structured.organization?.exclude?.length
    && /発生日|発見日|日付|いつ|年月日/.test(question)
    && !/どの記録|どの不適合|番号|品番|工程|現象|原因|処置|部署|機械/.test(question);
}

function hasRecentRequest(question) {
  return /最近|最新|直近/.test(question);
}

export function resolvedConditionCount(question, interpretation, conditions, exclude = {}, organization = null) {
  const include = isObject(interpretation?.include) ? interpretation.include : interpretation;
  const semanticInclude = Object.entries(include ?? {}).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value && value !== 'unknown' && value !== 'unspecified');
  const semanticExclude = isObject(interpretation?.exclude)
    ? Object.entries(interpretation.exclude).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    : [];
  return semanticInclude.length + semanticExclude.length + Object.keys(conditions).length + Object.keys(exclude).length
    + (organization?.include?.length || organization?.matchedTerms?.length ? 1 : 0)
    + (organization?.exclude?.length ? 1 : 0);
}

function matchesConditions(record, conditions) {
  return Object.entries(conditions).every(([field, expected]) => {
    const actual = field === 'nonconformityNo' ? text(record.nonconformityNo).replace(/^0+(?=\d)/, '') : text(record[field]);
    const wanted = field === 'nonconformityNo' ? String(expected).replace(/^0+(?=\d)/, '') : String(expected);
    return actual === wanted;
  });
}

function matchesOrganizationScope(record, values, matchedTerms = []) {
  const name = normalizedOrganizationValue(record.originDepartmentName);
  const code = normalizedOrganizationValue(record.originDepartmentCode);
  if (Array.isArray(matchedTerms) && matchedTerms.length > 0) {
    const facilityTerms = matchedTerms.filter((term) => isOrganizationFacilityTerm(term));
    const departmentTerms = matchedTerms.filter((term) => !isOrganizationFacilityTerm(term));
    return (facilityTerms.length === 0 || facilityTerms.some((term) => name.includes(normalizedOrganizationValue(term))))
      && departmentTerms.every((term) => name.includes(normalizedOrganizationValue(term)));
  }
  if (!Array.isArray(values) || values.length === 0) return false;
  return values.some((value) => normalizedOrganizationValue(value.name) === name
    && (!value.code || normalizedOrganizationValue(value.code) === code));
}

function compareRecentRecords(left, right) {
  const leftDate = text(left.discoveredOn);
  const rightDate = text(right.discoveredOn);
  if (!leftDate && rightDate) return 1;
  if (leftDate && !rightDate) return -1;
  const dateOrder = rightDate.localeCompare(leftDate);
  if (dateOrder !== 0) return dateOrder;
  const leftNo = text(left.nonconformityNo).replace(/^0+(?=\d)/u, '');
  const rightNo = text(right.nonconformityNo).replace(/^0+(?=\d)/u, '');
  if (/^\d+$/u.test(leftNo) && /^\d+$/u.test(rightNo) && leftNo.length <= 15 && rightNo.length <= 15) {
    return Number(rightNo) - Number(leftNo);
  }
  return rightNo.localeCompare(leftNo, 'ja');
}

function limitFromQuestion(question) {
  return explicitLimitFromQuestion(question) ?? 20;
}

function explicitLimitFromQuestion(question) {
  const match = question.normalize('NFKC').match(/([1-9][0-9]*)\s*件/u);
  return match ? Math.min(20, Number(match[1])) : null;
}

function entryFor(value) {
  return isObject(value) && isObject(value.classification)
    ? value
    : { classification: isObject(value) ? value : {}, judgments: {} };
}

function recordConditionState(entry, group, optionId) {
  const safeEntry = entryFor(entry);
  if (group.cardinality === 'single') {
    if (safeEntry.classification[group.id] === optionId) return 'yes';
    const probability = safeEntry.judgments?.[group.id]?.probabilities?.[optionId];
    return validProbability(probability) && probability >= RECORD_CHOICE_POLICY.candidateAt ? 'uncertain' : 'no';
  }
  const key = `${group.id}:${optionId}`;
  const judgment = safeEntry.judgments?.[key];
  if (!judgment || judgment.type !== 'noul' || !validProbability(judgment.noul)) return 'no';
  return recordNoulDecision(judgment.noul);
}

function semanticSearchMatch(entry, query) {
  const uncertain = [];
  const excludedUncertain = [];
  const groupsById = new Map((query.groups ?? []).map((group) => [group.id, group]));
  const include = query.semanticInclude ?? query.include ?? {};
  const exclude = query.semanticExclude ?? {};
  for (const [groupId, requested] of Object.entries(include)) {
    const group = groupsById.get(groupId);
    if (!group) continue;
    const values = Array.isArray(requested) ? requested : [requested];
    for (const optionId of values) {
      const state = recordConditionState(entry, group, optionId);
      if (state === 'no') return { ok: false, uncertain, excludedUncertain };
      if (state !== 'yes') uncertain.push({ groupId, optionId });
    }
  }
  for (const [groupId, requested] of Object.entries(exclude)) {
    const group = groupsById.get(groupId);
    if (!group) continue;
    const values = Array.isArray(requested) ? requested : [requested];
    for (const optionId of values) {
      const state = recordConditionState(entry, group, optionId);
      if (state === 'yes') return { ok: false, uncertain, excludedUncertain };
      if (state !== 'no') {
        // A negative condition is not proven by an ambiguous judgment. Do not
        // return the row as if the exclusion had been satisfied.
        excludedUncertain.push({ groupId, optionId });
        return { ok: false, uncertain, excludedUncertain };
      }
    }
  }
  return { ok: true, uncertain, excludedUncertain };
}

export function searchStored(store, query) {
  const matches = [];
  const uncertainRecordIds = [];
  const excludedUncertainRecordIds = [];
  const semanticRequired = Object.keys(query.semanticInclude ?? query.include ?? {}).length > 0
    || Object.keys(query.semanticExclude ?? {}).length > 0;
  for (const record of store.records) {
    const entry = store.classificationsById.get(record.id);
    const exactExclude = query.exactExclude ?? query.exclude ?? {};
    if (semanticRequired && !entry) continue;
    if (!matchesConditions(record, query.conditions ?? {})) continue;
    if (Object.keys(exactExclude).length && matchesConditions(record, exactExclude)) continue;
    if ((query.organization?.include?.length || query.organization?.matchedTerms?.length)
      && !matchesOrganizationScope(record, query.organization.include, query.organization.matchedTerms)) continue;
    if (query.organization?.exclude?.length && matchesOrganizationScope(record, query.organization.exclude)) continue;
    const semantic = semanticRequired ? semanticSearchMatch(entry, query) : { ok: true, uncertain: [], excludedUncertain: [] };
    if (!semantic.ok) {
      if (semantic.excludedUncertain.length) excludedUncertainRecordIds.push(record.id);
      continue;
    }
    matches.push(record);
    if (semantic.uncertain.length) uncertainRecordIds.push(record.id);
  }
  const ordered = query.sort?.field === 'discoveredOn' || hasRecentRequest(query.question)
    ? [...matches].sort(compareRecentRecords)
    : matches;
  return {
    records: ordered.slice(0, query.limit),
    uncertainRecordIds: uncertainRecordIds.filter((id) => ordered.slice(0, query.limit).some((record) => record.id === id)),
    excludedUncertainRecordIds,
  };
}

function queryConversationState(question, conversation = {}) {
  const safeConversation = isObject(conversation) ? conversation : {};
  const dialogue = Array.isArray(safeConversation.relatedHistory)
    ? safeConversation.relatedHistory.filter((item) => isObject(item) && typeof item.role === 'string' && typeof item.content === 'string').slice(-8)
    : [];
  const previousRequest = typeof safeConversation.searchRequest === 'string' && safeConversation.searchRequest.trim() && safeConversation.searchRequest !== question
    ? [{ role: 'user', content: safeConversation.searchRequest }]
    : [];
  return {
    request: question,
    relatedHistory: [...previousRequest, ...dialogue],
    confirmationPending: safeConversation.confirmationPending ?? safeConversation.pending ?? null,
    conversationTarget: safeConversation.conversationTarget ?? null,
    // The bounded SearchState is the source of truth for change intent. Do
    // not substitute the previous natural-language request for these values.
    searchState: safeConversation.searchState ? validateSearchState(safeConversation.searchState) : null,
    removalCandidates: (safeConversation.removalCandidates ?? []).map(({ id, label, values }) => ({ id, label, values })),
    fieldMentions: safeConversation.fieldMentions ?? [],
  };
}

function isCorrectionFeedback(question) {
  return /(?:混ざ|混在|違(?:う|って)|誤(?:り|って)|訂正|正しく)/u.test(question.normalize('NFKC'));
}

function isContinuationRequest(question, conversation = {}) {
  const safeConversation = isObject(conversation) ? conversation : {};
  const previous = typeof safeConversation.searchRequest === 'string' && safeConversation.searchRequest.trim();
  if (!previous) return false;
  if (safeConversation.confirmationPending ?? safeConversation.pending) return true;
  if (displayOnlyRequest(question, {})) return true;
  return /^(その|この|前の|該当|同じ|先ほど|さきほど|続き|上記|対象)/u.test(question.trim())
    || /(?:は|の|について)？(?:発生日|発見日|日付|原因|処置|対応|工程|現象|内容|番号|品番)[？?]?$/u.test(question.trim());
}

function effectiveConversationRequest(question, conversation = {}) {
  const safeConversation = isObject(conversation) ? conversation : {};
  const previous = typeof safeConversation.searchRequest === 'string' ? safeConversation.searchRequest.trim() : '';
  if (!previous || !isContinuationRequest(question, safeConversation)) {
    return { question, target: 'new_search', baseRequest: question };
  }
  return {
    question: `${previous}\n追加の要求: ${question}`,
    target: 'previous_search',
    baseRequest: previous,
  };
}

function explicitNewSearch(question) {
  return /(?:新しく|新規に|別の|別件|改めて|検索を切り替え)/u.test(question.normalize('NFKC'));
}

function explicitRemoval(question) {
  return /(?:外して|解除して|指定を外|指定なし|なしにして|取り除いて|除去して)/u.test(question.normalize('NFKC'));
}

function explicitReplacement(question) {
  return /(?:に変えて|に変更して|変更する|切り替えて|置き換えて)/u.test(question.normalize('NFKC'));
}

function removalCandidatesFor(state, definition) {
  if (state.revision === 0) return [];
  const candidates = [];
  const organization = state.exact.organization;
  const facilities = [...new Set(organization.matchedTerms.flatMap(embeddedOrganizationFacilityTerms))];
  const departments = previousOrganizationTermsAfterFacility(organization);
  if (facilities.length) candidates.push({ id: 'organization_facility', label: '工場・拠点の限定条件（部署条件は残す）', values: facilities, remove: { organizationFacility: true }, remainingTerms: departments });
  if (departments.length) candidates.push({ id: 'organization_department', label: '部署の限定条件（工場・拠点条件は残す）', values: departments, remove: { organization: true }, remainingTerms: facilities });
  if (facilities.length > 1) for (const term of facilities) {
    candidates.push({ id: `organization_facility:${term}`, label: '指定した工場・拠点だけの限定条件（ほかの拠点・部署条件は残す）', values: [term], remove: { organizationFacility: true }, remainingTerms: [...facilities.filter((value) => value !== term), ...departments] });
  }
  if (departments.length > 1) for (const term of departments) {
    candidates.push({ id: `organization_department:${term}`, label: '指定した部署だけの条件（工場・ほかの部署条件は残す）', values: [term], remove: { organization: true }, remainingTerms: [...facilities, ...departments.filter((value) => value !== term)] });
  }
  for (const [index, excluded] of organization.exclude.entries()) {
    candidates.push({ id: `organization_exclude:${index}`, label: '指定した組織の除外条件だけ（含む条件とほかの除外条件は残す）', values: { exclude: excluded }, remove: { organization: true }, organization: { ...organization, exclude: organization.exclude.filter((_, position) => position !== index) } });
  }
  if ((facilities.length && departments.length) || organization.exclude.length
    || (!facilities.length && !departments.length && organization.include.length)) {
    candidates.push({ id: 'organization_all', label: '工場・部署・組織除外の条件をすべて解除する', values: organization, remove: { organization: true } });
  }
  for (const kind of ['exact', 'semantic']) {
    for (const field of new Set([...Object.keys(state[kind].include), ...Object.keys(state[kind].exclude)])) {
      const group = kind === 'semantic' ? definition.groups.find(({ id }) => id === field) : null;
      const label = group?.label ?? field;
      const valuesFor = (value) => Array.isArray(value) ? value : value ? [value] : [];
      const describe = (value) => valuesFor(value).map((id) => group?.options.find((option) => option.id === id)?.description ?? id);
      const remove = { [`${kind}Fields`]: [field] };
      candidates.push({ id: `${kind}:${field}`, label, values: { include: describe(state[kind].include[field]), exclude: describe(state[kind].exclude[field]) }, remove });
      const conditions = ['include', 'exclude'].flatMap((polarity) => valuesFor(state[kind][polarity][field]).map((id) => ({ polarity, id })));
      if (conditions.length > 1) {
        for (const { polarity, id } of conditions) {
          const retained = { include: {}, exclude: {} };
          for (const side of ['include', 'exclude']) {
            const previous = state[kind][side][field];
            const remaining = valuesFor(previous).filter((value) => side !== polarity || value !== id);
            if (remaining.length) retained[side][field] = Array.isArray(previous) ? remaining : remaining[0];
          }
          candidates.push({ id: `${kind}:${field}:${polarity}:${id}`, label: `${label}の個別条件（ほかの値・除外条件は残す）`, values: { [polarity]: describe(id) }, remove, [kind]: retained });
        }
      }
    }
  }
  candidates.push({ id: 'limit', label: '返す記録数の指定', values: state.limit, remove: { limit: true } });
  if (state.sort) candidates.push({ id: 'sort', label: '記録の並び順の指定', values: state.sort, remove: { sort: true } });
  if (state.display.requested.length) candidates.push({ id: 'display', label: '表示項目の指定（原文表示は維持）', values: state.display.requested, remove: { display: true } });
  return candidates;
}

function resolveRemovalTarget(evaluated, candidates, previousState, records) {
  const judgment = evaluated.judgments.removal_target;
  const selected = candidates.find(({ id }) => id === judgment?.choice);
  if (!selected || judgment.confidence < QUERY_CHOICE_POLICY.uncertainBelow) {
    return { unresolved: [{ kind: 'action', field: 'removalTarget', reason: 'condition_to_remove_unresolved' }] };
  }
  if (!selected.remainingTerms) return { selected, organization: selected.organization, unresolved: [] };
  // Only code-owned, already confirmed remaining terms enter the resolver.
  // The removal utterance must not introduce a new organization restriction.
  const organization = resolveOrganizationConditions(selected.remainingTerms.join(' '), records);
  organization.exclude = previousState.exact.organization.exclude;
  return { selected, organization, unresolved: organization.unresolved };
}

// Compare predicates, never the rows currently satisfying them. In particular,
// facility alternatives are OR, department terms are AND, and exclusions retain
// their polarity. Candidate cardinality is not a proof of equal search scope.
function searchPredicates(state) {
  const value = validateSearchState(state);
  const values = (items) => [...new Set((Array.isArray(items) ? items : [items]).map((item) => text(item)))].sort();
  const map = (items) => Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b))
    .map(([field, expected]) => [field, values(expected)]));
  const organizations = (items) => values(items.map(({ name, code }) => JSON.stringify([
    normalizedOrganizationValue(name), code ? normalizedOrganizationValue(code) : null,
  ])));
  const organization = value.exact.organization;
  return {
    sources: values(value.sources),
    exactInclude: map(value.exact.include), exactExclude: map(value.exact.exclude),
    organization: {
      facilityAny: values(organization.matchedTerms.filter(isOrganizationFacilityTerm).map(normalizedOrganizationValue)),
      departmentAll: values(organization.matchedTerms.filter((term) => !isOrganizationFacilityTerm(term)).map(normalizedOrganizationValue)),
      // Legacy states without compact predicates still have a selected set.
      selectedAny: organization.matchedTerms.length ? [] : organizations(organization.include),
      excludeAny: organizations(organization.exclude),
    },
    semanticInclude: map(value.semantic.include), semanticExclude: map(value.semantic.exclude),
  };
}

function conditionEffect(question, evaluated, structured, independent, previousState) {
  const normalized = question.normalize('NFKC');
  const delta = {
    action: 'replace_condition',
    exact: { include: structured.include, exclude: structured.exclude,
      organization: structuredOrganizationForState(structured.organization) },
    semantic: { include: evaluated.query.include, exclude: evaluated.query.exclude },
    ...(explicitLimitFromQuestion(normalized) !== null ? { limit: explicitLimitFromQuestion(normalized) } : {}),
    ...(hasRecentRequest(normalized) ? { sort: { field: 'discoveredOn', direction: 'desc' } } : {}),
  };
  const continued = applySearchDelta(previousState, delta);
  const standalone = applySearchDelta(emptySearchState(), { ...delta, action: 'new_search',
    exact: { ...delta.exact, organization: structuredOrganizationForState(independent.organization) } });
  const before = searchPredicates(previousState);
  const after = searchPredicates(continued);
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const changedPredicates = Object.keys(before).filter((key) => !same(before[key], after[key]));
  const changedScalars = ['limit', 'sort'].filter((key) => !same(previousState[key], continued[key]));
  const unresolved = previousState.unresolvedConditions.length + (evaluated.query.unresolved?.length ?? 0)
    + (structured.unresolved?.length ?? 0) + (independent.unresolved?.length ?? 0);
  const overlaps = (kind) => Object.entries(continued[kind].include)
    .some(([field, included]) => {
      const excluded = continued[kind].exclude[field];
      if (!excluded) return false;
      const positives = Array.isArray(included) ? included : [included];
      const negatives = Array.isArray(excluded) ? excluded : [excluded];
      return positives.some((item) => negatives.includes(item));
    });
  // Preserve the selected reader's existing logic: live exact exclusions are
  // NOT(OR fields); the classified reader excludes the complete exact tuple.
  // Do not turn a partial overlap with that tuple into a contradictory request.
  const exactContradiction = exactSearchArguments(continued) ? overlaps('exact')
    : Object.keys(continued.exact.exclude).length > 0
      && matchesConditions(continued.exact.include, continued.exact.exclude);
  const contradictory = exactContradiction || overlaps('semantic');
  const targetEquivalent = !unresolved && !contradictory
    && same(after, searchPredicates(standalone))
    && ['limit', 'sort'].every((key) => same(continued[key], standalone[key]));
  return {
    changedPredicates, changedScalars, contradictory,
    targetEquivalent,
    targetImpact: evaluateAmbiguityImpact({
      ambiguity: { reason: unresolved ? 'unresolved_meaning' : 'different_interpretations' },
      existingCondition: targetEquivalent,
    }),
  };
}

function operationDecision(question, evaluated, previousState, effect = null) {
  const initialSearch = !previousState || previousState.revision === 0;
  const lexicalAction = explicitNewSearch(question)
    ? 'new_search'
    : explicitRemoval(question)
      ? 'remove_condition'
      : explicitReplacement(question)
        ? 'replace_condition'
        : isCorrectionFeedback(question)
          ? 'correct_condition'
          : null;
  const judgedAction = evaluated?.query?.changeAction ?? null;
  // Display is already an independently replaceable part of SearchDelta.
  // The JEV option need not add an action or schema to SearchState.
  const displayOnly = judgedAction === 'update_display';
  const mappedAction = displayOnly ? 'replace_condition' : judgedAction;
  const unresolvedTarget = evaluated.query.conversationTarget !== 'same_target'
    || evaluated.judgments.conversation_target.confidence < QUERY_CHOICE_POLICY.uncertainBelow;
  const equivalentNewSearch = !initialSearch && lexicalAction === 'new_search' && judgedAction === 'replace_condition'
    && evaluated.query.conversationTarget === 'new_search'
    && evaluated.judgments.conversation_target.confidence >= QUERY_CHOICE_POLICY.uncertainBelow
    && evaluated.judgments.change_action.confidence < QUERY_CHOICE_POLICY.uncertainBelow
    && effect?.targetImpact.action === RESOLUTION_ACTIONS.RESOLVE_EXISTING;
  const rejectionReason = displayOnly && (initialSearch || (unresolvedTarget
    && effect?.targetImpact.action !== RESOLUTION_ACTIONS.RESOLVE_EXISTING)) ? 'display_target_unresolved'
    : displayOnly && evaluated.judgments.change_action.confidence < QUERY_CHOICE_POLICY.uncertainBelow ? 'display_operation_uncertain'
      : initialSearch ? null
        : judgedAction === 'clarify' ? 'jev_clarification'
          : !['add_condition', 'replace_condition', 'remove_condition', 'correct_condition', 'new_search'].includes(mappedAction) ? 'jev_action_unavailable'
            : lexicalAction && lexicalAction !== mappedAction && !equivalentNewSearch ? 'lexical_action_mismatch' : null;
  return {
    initialSearch, lexicalAction, judgedAction, rejectionReason,
    action: rejectionReason ? null : initialSearch || equivalentNewSearch ? 'new_search' : mappedAction,
  };
}

function deltaAction(question, evaluated, previousState) {
  return operationDecision(question, evaluated, previousState).action;
}

function structuredOrganizationForState(organization) {
  if (!organization || (!organization.include?.length && !organization.exclude?.length && !organization.matchedTerms?.length)) return undefined;
  return {
    include: organization.include ?? [],
    exclude: organization.exclude ?? [],
    matchedTerms: organization.matchedTerms ?? [],
    status: organization.unresolved?.length ? 'unresolved' : 'resolved',
  };
}

function buildSearchDelta(question, evaluated, structured, previousState, removal = null, effect = null) {
  const operation = operationDecision(question, evaluated, previousState, effect);
  const action = operation.action;
  const appliedAction = action ?? 'clarify';
  const normalized = question.normalize('NFKC');
  const exactInclude = { ...structured.include };
  const exactExclude = { ...structured.exclude };
  const semanticInclude = evaluated.query?.include ?? {};
  const semanticExclude = { ...(evaluated.query?.exclude ?? {}) };
  // A correction/feedback turn must not invert an already confirmed positive
  // condition merely because JEV represented the wording as an exclusion.
  // The bounded SearchState remains authoritative; only contradictory values
  // from this turn are discarded, while unrelated conditions still apply.
  if (action === 'correct_condition') {
    for (const [groupId, requested] of Object.entries(semanticExclude)) {
      const prior = previousState.semantic.include[groupId];
      const priorValues = Array.isArray(prior) ? prior : prior ? [prior] : [];
      const requestedValues = Array.isArray(requested) ? requested : [requested];
      const remaining = requestedValues.filter((value) => !priorValues.includes(value));
      if (remaining.length) semanticExclude[groupId] = remaining;
      else delete semanticExclude[groupId];
    }
  }
  const delta = {
    action: appliedAction,
    exact: {
      include: exactInclude,
      exclude: exactExclude,
      organization: structuredOrganizationForState(structured.organization),
    },
    semantic: { include: semanticInclude, exclude: semanticExclude },
    unresolvedConditions: [
      // Inclusion/exclusion questions are speculative on a removal turn.
      // Their answers do not select its target or add replacement conditions.
      ...(appliedAction === 'remove_condition' ? (removal?.unresolved ?? []) : (evaluated.query?.unresolved ?? [])),
      ...(structured.unresolved ?? []),
      ...(action ? [] : [{
        kind: ['display_target_unresolved', 'display_operation_uncertain'].includes(operation.rejectionReason) ? 'display' : 'action',
        field: 'changeAction', term: question, reason: 'change_intent_unresolved',
      }]),
    ],
  };
  let requestedDisplay = evaluated.query?.display ?? displayRequestFrom(question, evaluated.judgments ?? {});
  if (appliedAction === 'new_search' || requestedDisplay.requested?.length) delta.display = requestedDisplay;
  const unsupportedSource = normalized.match(/(?:設備点検|計測機器|作業要領書|作業要領|要領書)/u)?.[0];
  if (unsupportedSource) {
    delta.unresolvedConditions.push({ kind: 'source', field: 'source', term: unsupportedSource, reason: 'source_not_connected_in_this_milestone' });
  }
  const limit = explicitLimitFromQuestion(normalized);
  if (limit !== null) delta.limit = limit;
  if (hasRecentRequest(normalized)) delta.sort = { field: 'discoveredOn', direction: 'desc' };
  if (evaluated.query?.changeAction === 'update_display') {
    if (mentionedSourceHeadings(question).length) {
      // Code resolves the source field; JEV resolves whether showing it is
      // requested. Generic semantic guesses cannot override an exact heading.
      if (evaluated.judgments.display_source_heading?.noul >= QUERY_DECISION_POLICY.includeAt) {
        const otherIntent = evaluated.judgments.display_other_fields?.noul;
        if (otherIntent >= QUERY_DECISION_POLICY.includeAt) {
          if (!requestedDisplay.requested?.length || requestedDisplay.requested.some((id) => !(evaluated.judgments[`display:${id}`]?.noul >= QUERY_DECISION_POLICY.includeAt))) {
            delta.unresolvedConditions.push({ kind: 'display', field: 'display', term: question, reason: 'display_intent_unresolved' });
          }
          requestedDisplay = { originalText: true, requested: [...new Set(['originalText', ...requestedDisplay.requested])] };
        } else {
          if (!(otherIntent < QUERY_DECISION_POLICY.uncertainFrom)) {
            delta.unresolvedConditions.push({ kind: 'display', field: 'display', term: question, reason: 'display_intent_unresolved' });
          }
          requestedDisplay = { originalText: true, requested: ['originalText'] };
        }
      } else {
        delta.unresolvedConditions.push({ kind: 'display', field: 'display', term: question, reason: 'display_heading_intent_unresolved' });
      }
    } else if (!requestedDisplay.requested?.length) {
      delta.unresolvedConditions.push({ kind: 'display', field: 'display', term: question, reason: 'display_field_unresolved' });
    } else if (requestedDisplay.requested.some((id) => !(evaluated.judgments[`display:${id}`]?.noul >= QUERY_DECISION_POLICY.includeAt))) {
      delta.unresolvedConditions.push({ kind: 'display', field: 'display', term: question, reason: 'display_intent_unresolved' });
    }
    // Reasserting a predicate is not a change. Explicit count/order updates
    // are scalar replacements; a different/contradictory predicate still needs
    // a condition operation, not a silently successful display-only response.
    if (!effect || effect.changedPredicates.length || effect.contradictory) {
      delta.unresolvedConditions.push({ kind: 'action', field: 'changeAction', term: question, reason: 'display_condition_conflict' });
    }
    return { action: appliedAction, display: requestedDisplay,
      ...(effect?.changedScalars.includes('limit') ? { limit: delta.limit } : {}),
      ...(effect?.changedScalars.includes('sort') ? { sort: delta.sort } : {}),
      unresolvedConditions: [...previousState.unresolvedConditions, ...delta.unresolvedConditions] };
  }
  if (appliedAction === 'remove_condition') {
    delta.remove = removal?.selected?.remove ?? {};
    delta.exact = { include: {}, exclude: {}, ...removal?.selected?.exact, organization: structuredOrganizationForState(removal?.organization) };
    delta.semantic = removal?.selected?.semantic ?? { include: {}, exclude: {} };
    // Removing one condition never replaces an unrelated limit, order, or
    // display setting merely because those words also appeared in the request.
    delete delta.limit;
    delete delta.sort;
    delete delta.display;
  }
  return delta;
}

function queryFromSearchState(question, state) {
  return {
    question,
    classification: {},
    groups: [],
    conditions: state.exact.include,
    exactExclude: state.exact.exclude,
    organization: state.exact.organization,
    semanticInclude: state.semantic.include,
    semanticExclude: state.semantic.exclude,
    limit: state.limit,
    sort: state.sort,
  };
}

async function classifyText(question, definition, evaluate, mode, conversation = {}) {
  const questions = buildQuestions(definition, mode, conversation.removalCandidates, conversation.fieldMentions);
  const sourceHeadings = mode === 'query' ? mentionedSourceHeadings(question) : [];
  if (sourceHeadings.length) {
    questions.display_source_heading = noulQuestion(
      `ユーザーは次の情報源項目を表示することを明確に求めているか: ${sourceHeadings.map(({ label }) => label).join('、')}。現在の要求と会話状態に基づき、項目を表示する肯定的な要求と、非表示・表示の禁止・検索条件の指定・単なる言及を区別する。一つでも非表示を求めている、または表示意図が確定しない場合は肯定しない。`,
      '挙げた項目を表示する肯定的な要求であり、非表示の要求はない。',
      '非表示の要求、検索条件、単なる言及、または表示意図を確定できない。',
    );
    questions.display_other_fields = noulQuestion(
      `要求中の項目「${sourceHeadings.map(({ label }) => label).join('、')}」そのものとは別に、他の表示内容も独立して求めているか。項目名に含まれる文字や関連しそうな意味から別項目を補わない。表示内容の候補: ${DISPLAY_REQUESTS.map(([, description]) => description).join('、')}。`,
      '情報源の項目名とは別に、追加の表示内容も明確に要求している。',
      '情報源の項目名への要求だけであり、別の表示内容は独立して要求していない。',
    );
  }
  const result = await evaluate({
    model: 'typesafe-ai/jev',
    state: mode === 'query' ? queryConversationState(question, conversation) : { request: question, relatedHistory: [], confirmationPending: null },
    questions,
    maxRetries: 0
  });
  const evaluated = classificationFromAnswers(result?.answers, definition, mode, question);
  if (sourceHeadings.length) {
    evaluated.judgments.display_source_heading = normalizeNoulJudgment(result.answers.display_source_heading, 'display_source_heading');
    evaluated.judgments.display_other_fields = normalizeNoulJudgment(result.answers.display_other_fields, 'display_other_fields');
  }
  if (mode === 'query' && conversation.removalCandidates?.length) {
    evaluated.judgments.removal_target = normalizeChoiceJudgment(result.answers.removal_target,
      [{ id: QUERY_NONE }, ...conversation.removalCandidates], 'removal_target');
  }
  if (mode === 'query' && evaluated.query?.changeAction !== 'remove_condition') for (const mention of conversation.fieldMentions ?? []) {
    evaluated.judgments[mention.id] = normalizeChoiceJudgment(result.answers[mention.id],
      ['field_reference', 'condition_value', 'unresolved'].map((id) => ({ id })), mention.id);
  }
  return { ...evaluated, model: result?.model ?? null, response: result?.response ?? null, usage: result?.usage ?? null };
}

export class AuthorizedRecordClassifier {
  constructor({ snapshotPath, storePath, evaluateImplementation = createTypesafeDirectEvaluate(), classificationEnabled = process.env.HERMES_SEARCH_RECORD_CLASSIFICATION_ENABLED !== 'false' } = {}) {
    this.snapshotPath = snapshotPath;
    this.storePath = storePath;
    this.evaluateImplementation = evaluateImplementation;
    this.classificationEnabled = classificationEnabled;
    this.definition = null;
    this.store = null;
    this.runtime = null;
    this.calls = [];
    this.pendingRecordIds = new Set();
    this.classificationPromise = null;
    this.closed = false;
  }

  async persistStore() {
    const classifications = this.store.records
      .map((record) => {
        const evaluated = this.store.classificationsById.get(record.id);
        return evaluated ? { id: record.id, ...evaluated } : null;
      })
      .filter(Boolean);
    this.store.classifications = classifications;
    await writeStore(this.storePath, {
      schema: CLASSIFIER_SCHEMA,
      definitionSha256: this.store.definitionSha256,
      definition: this.definition,
      source: this.store.source,
      records: this.store.records,
      classifications,
      pendingRecordIds: [...this.pendingRecordIds],
    });
  }

  async classifyPending(records, { continueOnError = false } = {}) {
    for (const record of records) {
      if (this.closed) return;
      const started = performance.now();
      try {
        const evaluated = await classifyText(record.rawText, this.definition, this.evaluateImplementation, 'record');
        this.calls.push({ phase: 'record', recordIdSha256: sha256(record.id), requestSha256: sha256(record.rawText), questionCount: Object.keys(buildQuestions(this.definition, 'record')).length, elapsedMs: Number((performance.now() - started).toFixed(3)) });
        this.store.classificationsById.set(record.id, { classification: evaluated.classification, judgments: evaluated.judgments });
        this.pendingRecordIds.delete(record.id);
        this.runtime.classifiedRecordCount += 1;
        this.runtime.pendingRecordCount = this.pendingRecordIds.size;
        await this.persistStore();
      } catch (error) {
        this.runtime.classificationFailureCount += 1;
        this.runtime.pendingRecordCount = this.pendingRecordIds.size;
        this.runtime.classificationStatus = 'partial';
        if (!continueOnError) throw error;
      }
    }
    this.runtime.pendingRecordCount = this.pendingRecordIds.size;
    this.runtime.classificationStatus = this.pendingRecordIds.size === 0 ? 'complete' : 'partial';
  }

  async prepare({ background = false } = {}) {
    if (!this.snapshotPath || !this.storePath) throw new Error('record classification source and store are required');
    if (this.runtime) return this.runtime;
    const records = await readSnapshot(this.snapshotPath);
    const saved = await readStore(this.storePath);
    this.definition = buildClassificationDefinition(records, saved?.definition);
    const definitionSha256 = definitionHash(this.definition);
    const savedRecords = new Map((saved?.records ?? []).map((record) => [record.id, record]));
    const savedClassifications = new Map((saved?.classifications ?? []).map((classification) => [classification.id, classification]));
    const classificationsById = new Map();
    const pendingRecords = [];
    let reusedRecordCount = 0;
    for (const record of records) {
      const previous = savedRecords.get(record.id);
      const previousClassification = savedClassifications.get(record.id);
      const reusable = reusableClassification(previousClassification, saved?.definition, this.definition);
      if (previous?.sourceContentSha256 === record.sourceContentSha256 && reusable) {
        classificationsById.set(record.id, reusable);
        reusedRecordCount += 1;
        continue;
      }
      pendingRecords.push(record);
    }
    this.pendingRecordIds = new Set(pendingRecords.map((record) => record.id));
    this.store = {
      schema: CLASSIFIER_SCHEMA,
      definitionSha256,
      source: { snapshotDigest: sha256(canonicalJson(records)), recordCount: records.length },
      records,
      classifications: [],
      classificationsById,
    };
    this.runtime = {
      definitionVersion: CLASSIFIER_DEFINITION_VERSION,
      definitionSha256,
      recordCount: records.length,
      reusedRecordCount,
      classifiedRecordCount: 0,
      pendingRecordCount: pendingRecords.length,
      classificationFailureCount: 0,
      classificationStatus: !this.classificationEnabled ? 'disabled' : pendingRecords.length === 0 ? 'complete' : 'running',
      classificationEnabled: this.classificationEnabled,
      classificationCalls: this.calls.filter((call) => call.phase === 'record').length,
      source: 'authorized latest nonconformity snapshot'
    };
    if (!this.classificationEnabled) return this.runtime;
    await this.persistStore();
    if (background) {
      this.classificationPromise = this.classifyPending(pendingRecords, { continueOnError: true }).catch(() => {
        this.runtime.classificationStatus = 'partial';
      });
    } else {
      await this.classifyPending(pendingRecords);
    }
    return this.runtime;
  }

  coverage() {
    const total = this.store?.records.length ?? 0;
    const classified = this.store?.classificationsById.size ?? 0;
    return { total, classified, pending: Math.max(0, total - classified), complete: total > 0 && classified === total };
  }

  coverageNotice(coverage) {
    if (coverage.complete) return '';
    if (this.runtime?.classificationStatus === 'disabled') {
      return `事前分類は停止中です。分類済み ${coverage.classified}/${coverage.total} 件を検索対象にしています。未分類の記録は結果に含まれていません。`;
    }
    if (this.runtime?.classificationStatus === 'partial') {
      return `事前分類は未完了です。分類済み ${coverage.classified}/${coverage.total} 件を検索対象にしています。未分類の記録は結果に含まれていません。`;
    }
    return `分類処理中のため、現在は分類済み ${coverage.classified}/${coverage.total} 件だけが検索対象です。未分類の記録は結果に含まれていません。`;
  }

  sessionFor(question, conversation, pending, searchRequest = question, conversationTarget = 'new_search', searchState = emptySearchState()) {
    const safeConversation = isObject(conversation) ? conversation : {};
    return {
      pending: pending ?? null,
      searchRequest: searchState.revision > 0 ? null : searchRequest,
      conversationTarget,
      searchState: validateSearchState(searchState),
      jevDialogue: Array.isArray(safeConversation.relatedHistory)
        ? safeConversation.relatedHistory.filter((item) => isObject(item) && item.role === 'assistant' && typeof item.content === 'string').slice(-8)
        : [],
    };
  }

  async answer(question, conversation = {}) {
    if (!this.store || !this.definition) throw new Error('record classifier is not ready');
    const started = performance.now();
    const safeConversation = isObject(conversation) ? conversation : {};
    const pending = safeConversation.confirmationPending ?? safeConversation.pending ?? null;
    const previousState = safeConversation.searchState ? validateSearchState(safeConversation.searchState) : emptySearchState();
    const removalCandidates = removalCandidatesFor(previousState, this.definition);
    const fieldMentions = explicitRemoval(question) ? [] : organizationQuestionInput(question, this.store.records).mentions;
    const conversationTarget = previousState.revision > 0 ? 'previous_search' : 'new_search';
    let operationInput;
    const evaluated = await classifyText(question, this.definition, async (input) => {
      // Capture only this decision's actual input. Never expose source records,
      // provider credentials, the complete response or unrelated JEV questions.
      operationInput = {
        searchState: input.state.searchState,
        conversationTarget: input.state.conversationTarget,
        confirmationPendingPresent: Boolean(input.state.confirmationPending),
        relatedHistoryCount: input.state.relatedHistory.length,
        questions: {
          conversation_target: input.questions.conversation_target,
          change_action: input.questions.change_action,
        },
      };
      const callStarted = performance.now();
      const result = await this.evaluateImplementation(input);
      this.calls.push({ phase: 'query', requestSha256: sha256(question), questionCount: Object.keys(input.questions).length, elapsedMs: Number((performance.now() - callStarted).toFixed(3)) });
      return result;
    }, 'query', {
      ...safeConversation,
    searchRequest: previousState.revision > 0 ? null : safeConversation.searchRequest,
      conversationTarget,
      searchState: previousState,
      removalCandidates,
      fieldMentions,
    });
    const coverage = this.coverage();
    const removing = deltaAction(question, evaluated, previousState) === 'remove_condition';
    const removal = removing ? resolveRemovalTarget(evaluated, removalCandidates, previousState, this.store.records) : null;
    const organizationContext = previousState.revision > 0 && !explicitNewSearch(question)
      && !explicitRemoval(question)
      ? previousState.exact.organization
      : null;
    const structured = removing
      ? { include: {}, exclude: {}, organization: removal.organization, unresolved: [] }
      : extractStructuredConditions(question, this.store.records, {
      organization: organizationContext,
      fieldMentionJudgments: evaluated.judgments,
    });
    const effect = evaluated.query.changeAction === 'update_display'
      || (explicitNewSearch(question) && evaluated.query.changeAction === 'replace_condition'
        && evaluated.query.conversationTarget === 'new_search'
        && evaluated.judgments.conversation_target.confidence >= QUERY_CHOICE_POLICY.uncertainBelow
        && evaluated.judgments.change_action.confidence < QUERY_CHOICE_POLICY.uncertainBelow)
      ? conditionEffect(question, evaluated, structured, extractStructuredConditions(question, this.store.records, {
        fieldMentionJudgments: evaluated.judgments,
      }), previousState) : null;
    const delta = buildSearchDelta(question, evaluated, structured, previousState, removal, effect);
    const pendingDisplayOnly = Array.isArray(pending?.requiredItems) && pending.requiredItems.length > 0
      && pending.requiredItems.every((item) => item?.type === 'display');
    const retainedPending = evaluated.query.changeAction === 'update_display' && pendingDisplayOnly ? null : pending;
    const confirmedDisplay = evaluated.query.changeAction === 'update_display' && pendingDisplayOnly
      ? pending.confirmedInfo?.display : null;
    const confirmedDisplayRequests = [...(confirmedDisplay?.requested ?? [])];
    if (evaluated.query.changeAction === 'update_display' && delta.action !== 'clarify') {
      const hasSourceHeading = mentionedSourceHeadings(question).length > 0;
      if (hasSourceHeading && evaluated.judgments.display_source_heading?.noul >= QUERY_DECISION_POLICY.includeAt) {
        confirmedDisplayRequests.push('originalText');
      }
      if (!hasSourceHeading || evaluated.judgments.display_other_fields?.noul >= QUERY_DECISION_POLICY.includeAt) {
        confirmedDisplayRequests.push(...evaluated.query.display.requested.filter((id) =>
          evaluated.judgments[`display:${id}`]?.noul >= QUERY_DECISION_POLICY.includeAt));
      }
    }
    if (confirmedDisplay && delta.display) {
      delta.display = { originalText: true,
        requested: [...new Set([...confirmedDisplay.requested, ...delta.display.requested])] };
    }
    if (evaluated.query.changeAction === 'update_display' && retainedPending) {
      delta.unresolvedConditions.push({ kind: 'action', field: 'changeAction', reason: 'pending_condition_requires_resolution' });
    }
    const deltaDigest = deltaFingerprint(delta);
    const operationDiagnostic = {
      model: evaluated.model,
      requestSha256: sha256(question),
      input: operationInput,
      conversationTargetJudgment: evaluated.judgments.conversation_target,
      changeActionJudgment: evaluated.judgments.change_action,
      displayHeadingJudgment: evaluated.judgments.display_source_heading ?? null,
      displayOtherFieldsJudgment: evaluated.judgments.display_other_fields ?? null,
      code: operationDecision(question, evaluated, previousState, effect),
      ...(effect ? { conditionEffect: effect } : {}),
      organization: {
        ...structuredOrganizationForState(structured.organization),
        unresolved: structured.organization?.unresolved ?? [],
        resolution: structured.organization?.resolution ?? null,
      },
      proposedDelta: delta,
    };
    const allUnresolved = delta.unresolvedConditions ?? [];
    const unresolvedLabels = allUnresolved.map((item) => {
      if (item.kind === undefined) return `起因部署の範囲: ${item.term}`;
      if (item.field === 'removalTarget') return `解除する条件（${removalCandidates.map(({ label }) => label).join('、')}）`;
      const group = this.definition.groups.find((candidate) => candidate.id === item.groupId);
      const option = group?.options?.find((candidate) => candidate.id === item.optionId);
      return `${group?.label ?? item.field ?? item.groupId}: ${option?.description ?? item.term ?? item.optionId ?? item.reason}`;
    });
    const nextState = allUnresolved.length ? previousState : applySearchDelta(previousState, delta);
    const semanticInclude = nextState.semantic.include;
    const semanticExclude = nextState.semantic.exclude;
    const display = nextState.display;
    const query = {
      question,
      classification: evaluated.classification,
      groups: this.definition.groups,
      conditions: nextState.exact.include,
      exactExclude: nextState.exact.exclude,
      organization: nextState.exact.organization,
      semanticInclude,
      semanticExclude,
      limit: nextState.limit,
      sort: nextState.sort,
    };
    const coverageNotice = hasSemanticConditions(nextState) ? this.coverageNotice(coverage) : '';
    const displayOnly = nextState.revision === 1 && delta.action === 'new_search' && displayOnlyRequest(question, structured.include, structured);
    const conditionCount = resolvedConditionCount(question, { include: semanticInclude, exclude: semanticExclude }, nextState.exact.include, nextState.exact.exclude, nextState.exact.organization);
    const conditionChange = removing ? {
      model: evaluated.model,
      operationJudgment: evaluated.judgments.change_action,
      targetJudgment: evaluated.judgments.removal_target ?? null,
      candidates: removalCandidates.map(({ id, label, values }) => ({ id, label, values })),
      selectedTarget: removal.selected?.id ?? null,
      remove: delta.remove,
      resolutionImpact: removal.organization?.resolution ?? null,
      remainingConditionCount: conditionCount,
      rejectionReason: allUnresolved.length ? 'removal_target_unresolved' : conditionCount === 0 ? 'no_remaining_conditions' : null,
    } : undefined;
    if (allUnresolved.length || conditionCount === 0 || displayOnly) {
      const nextPending = evaluated.query.changeAction === 'update_display' && retainedPending ? retainedPending : allUnresolved.length
        ? {
          request: question,
          question: `次の検索条件の意味を確認してください: ${unresolvedLabels.join('、')}`,
          purpose: 'resolve_search_condition',
          requiredItems: allUnresolved.map((item) => ({
            id: item.kind === undefined ? `structured:organization:${item.term}` : `${item.kind}:${item.groupId ?? item.field}:${item.optionId ?? item.reason}`,
            label: item.kind === undefined ? '起因部署の範囲' : this.definition.groups.find((group) => group.id === item.groupId)?.label ?? item.field ?? item.groupId,
            type: item.kind === undefined ? 'choice' : item.kind,
            candidates: item.field === 'removalTarget' ? removalCandidates.map(({ id, label }) => ({ id, label })) : item.kind === undefined ? [] : [item.optionId],
          })),
          confirmedInfo: { ...structured.include, organization: structured.organization,
            ...(confirmedDisplayRequests.length
              ? { display: { originalText: true, requested: [...new Set(confirmedDisplayRequests)] } } : {}),
          },
          unresolvedItems: allUnresolved.map((item) => item.kind === undefined ? `structured:organization:${item.term}` : `${item.kind}:${item.groupId ?? item.field}:${item.optionId ?? item.reason}`),
        }
        : pending;
      const clarification = allUnresolved.length
        ? `検索条件の解釈を確定できませんでした。${unresolvedLabels.join('、')}について、対象範囲を指定してください。`
        : displayOnly
          ? '発生日を確認する対象の不適合番号、品番、工程、現象、部署などを指定してください。'
          : '検索条件を特定できませんでした。工程、現象、処置、原因、品番、不適合番号、部署などを指定してください。';
      return {
        status: 'clarification',
        answer: [coverageNotice, clarification].filter(Boolean).join('\n\n'),
        recordIds: [],
        confirmationPending: nextPending,
        classifier: {
          classification: evaluated.classification,
          conditions: nextState.exact.include,
          exclude: nextState.exact.exclude,
          organization: nextState.exact.organization,
          resolutionImpact: structured.organization?.resolution ?? null,
          search: { include: semanticInclude, exclude: semanticExclude, unresolved: allUnresolved, target: conversationTarget },
          display,
          reason: allUnresolved.length ? 'conditions_ambiguous' : 'conditions_not_resolved',
          coverage,
        },
        searchState: previousState,
        searchDelta: { action: delta.action, digest: deltaDigest, applied: false },
        searchDiagnostics: {
          before: stateFingerprint(previousState),
          after: stateFingerprint(previousState),
          delta: deltaDigest,
          state: searchStateSummary(previousState),
          resultCount: 0,
          operationDecision: operationDiagnostic,
          ...(conditionChange ? { conditionChange } : {}),
        },
        session: this.sessionFor(question, safeConversation, nextPending, question, conversationTarget, previousState),
        elapsedMs: Number((performance.now() - started).toFixed(3))
      };
    }
    const search = searchStored(this.store, query);
    const records = search.records;
    const uncertaintyNotice = search.uncertainRecordIds.length
      ? `分類が不確かな候補 ${search.uncertainRecordIds.length} 件を含みます。原文を確認して判断してください。`
      : '';
    const excludedUncertainNotice = search.excludedUncertainRecordIds.length
      ? `除外条件の分類を確定できない ${search.excludedUncertainRecordIds.length} 件は、条件を満たすと断定せず結果から除外しました。`
      : '';
    const answer = records.map((record) => record.rawText).join('\n\n');
    return {
      status: 'completed',
      answer: [coverageNotice, uncertaintyNotice, excludedUncertainNotice, answer || '指定条件に一致する記録はありませんでした。未分類の記録については判断していません。'].filter(Boolean).join('\n\n'),
      recordIds: records.map((record) => `nonconformity:${record.id}`),
      confirmationPending: retainedPending,
      classifier: {
        classification: evaluated.classification,
        conditions: nextState.exact.include,
        exclude: nextState.exact.exclude,
        organization: nextState.exact.organization,
        resolutionImpact: structured.organization?.resolution ?? null,
        search: { include: semanticInclude, exclude: semanticExclude, unresolved: allUnresolved, target: conversationTarget },
        display,
        matchedCount: records.length,
        uncertainRecordIds: search.uncertainRecordIds,
        excludedUncertainRecordIds: search.excludedUncertainRecordIds,
        limit: query.limit,
        coverage,
      },
      searchState: nextState,
      searchDelta: { action: delta.action, digest: deltaDigest, applied: true },
      searchPlan: exactSearchArguments(nextState)
        ? { mode: 'exact', source: 'nonconformity', args: exactSearchArguments(nextState) }
        : { mode: 'classified' },
      searchDiagnostics: {
        before: stateFingerprint(previousState),
        after: stateFingerprint(nextState),
        delta: deltaDigest,
        state: searchStateSummary(nextState),
        resultCount: records.length,
        classificationCoverage: coverage,
        operationDecision: operationDiagnostic,
        ...(conditionChange ? { conditionChange } : {}),
      },
      session: this.sessionFor(question, safeConversation, null, question, conversationTarget, nextState),
      elapsedMs: Number((performance.now() - started).toFixed(3))
    };
  }

  metrics() {
    return { ...this.runtime, ...this.coverage(), classificationCalls: this.calls.filter((call) => call.phase === 'record').length, queryClassificationCalls: this.calls.filter((call) => call.phase === 'query').length, apiCalls: this.calls.length, calls: this.calls };
  }

  async close() { this.closed = true; }
}

export { GROUPS };
