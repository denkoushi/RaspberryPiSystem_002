import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { createTypesafeDirectEvaluate } from './hermes-jev-record-pilot.mjs';
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

export const CLASSIFIER_SCHEMA = 'hermes-jev-record-classification/v2';
export const CLASSIFIER_DEFINITION_VERSION = 4;
const PREVIOUS_CLASSIFIER_DEFINITION_VERSION = 3;

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
  const fields = [
    ['不適合番号', record.nonconformityNo], ['品番', record.partNumber], ['品名', record.partName],
    ['機械名', record.machineName], ['起因部署', record.originDepartmentName], ['発見日', record.discoveredOn],
    ['不適合内容', record.condition], ['備考', record.remarks], ['個別是正内容', record.correctiveContent], ['処置内容', record.disposition]
  ];
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

function buildQueryQuestions(definition) {
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
    '前回の確定条件に対するこのメッセージの操作を選ぶ。条件を追加、指定項目だけを置換、指定項目を解除、訂正、または新規検索する。意味を確定できなければ clarify を選ぶ。',
    [
      { id: 'add_condition', description: '前回の条件を保持して条件を追加する' },
      { id: 'replace_condition', description: '指定された条件項目だけを置換する' },
      { id: 'remove_condition', description: '指定された条件項目を解除する' },
      { id: 'correct_condition', description: '前回の条件の誤りを訂正する' },
      { id: 'new_search', description: '前回とは別の検索を開始する' },
      { id: 'clarify', description: '操作の意味を確定できないので確認する' },
    ],
  );
  return questions;
}

function buildQuestions(definition, mode) {
  return mode === 'record' ? buildRecordQuestions(definition) : buildQueryQuestions(definition);
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
    { id: 'clarify', description: '意味不確定' },
  ], 'change_action');
  judgments.change_action = changeAction;
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
  const labels = new Set(['不適合番号', '品番', '品名', '機械名', '起因部署', '発見日', '不適合内容', '備考', '個別是正内容', '処置内容']);
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

function questionOrganizationTerms(question) {
  const normalized = text(question).normalize('NFKC');
  const terms = new Set();
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

function sameOrganizationValue(left, right) {
  return normalizedOrganizationValue(left?.name) === normalizedOrganizationValue(right?.name)
    && (!left?.code || !right?.code || normalizedOrganizationValue(left.code) === normalizedOrganizationValue(right.code));
}

function resolveOrganizationConditions(question, records, previousOrganization = null) {
  const allCandidates = organizationIndex(records);
  const requestedQuestionTerms = questionOrganizationTerms(question);
  const requestsFacility = requestedQuestionTerms.some((term) => [...ORGANIZATION_FACILITY_UNITS]
    .some((unit) => normalizedOrganizationValue(term).endsWith(normalizedOrganizationValue(unit))));
  const candidates = !requestsFacility && previousOrganization?.include?.length
    ? allCandidates.filter((candidate) => previousOrganization.include.some((value) => sameOrganizationValue(candidate, value)))
    : allCandidates;
  const knownTerms = new Map();
  for (const candidate of candidates) {
    for (const term of candidate.terms) {
      const key = normalizedOrganizationValue(term);
      if (!isOrganizationTerm(term)) continue;
      const values = knownTerms.get(key) ?? [];
      if (!values.some((value) => value.name === candidate.name && value.code === candidate.code)) values.push(candidate);
      knownTerms.set(key, values);
    }
  }
  const requested = [...knownTerms.entries()]
    .filter(([term]) => normalizedOrganizationValue(question).includes(term))
    .map(([term, values]) => ({ term, values }))
    .sort((left, right) => right.term.length - left.term.length);
  const unknown = questionOrganizationTerms(question).find((term) => isOrganizationTerm(term)
    && ![...knownTerms.keys()].some((known) => known === normalizedOrganizationValue(term)));
  if (requested.length === 0) {
    return unknown
      ? { include: [], exclude: [], unresolved: [{ field: 'originDepartmentName', term: unknown, reason: 'not_found' }] }
      : { include: [], exclude: [], unresolved: [] };
  }

  const selectedTerms = requested.filter((item, index) => index === 0 || !requested.some((other, otherIndex) => otherIndex < index && other.term.includes(item.term)));
  const selectedValues = candidates.filter((candidate) => selectedTerms.every(({ term }) => candidate.terms.some((candidateTerm) => normalizedOrganizationValue(candidateTerm) === term)));
  const facilityRequested = selectedTerms.some(({ term }) => {
    const raw = term;
    return [...ORGANIZATION_FACILITY_UNITS].some((unit) => raw.endsWith(normalizedOrganizationValue(unit)));
  });
  const distinctParents = new Set(selectedValues.map((candidate) => {
    const name = normalizedOrganizationValue(candidate.name);
    const unit = [...ORGANIZATION_FACILITY_UNITS].map(normalizedOrganizationValue).find((suffix) => name.includes(suffix));
    return unit ? name.slice(0, name.indexOf(unit) + unit.length) : name;
  }));
  const ambiguous = !facilityRequested && selectedValues.length > 1 && distinctParents.size > 1;
  const include = [];
  const exclude = [];
  for (const selected of selectedTerms) {
    const values = selectedValues.filter((candidate) => candidate.terms.some((candidateTerm) => normalizedOrganizationValue(candidateTerm) === selected.term));
    (organizationTermIsExcluded(question, selected.term) ? exclude : include).push(...values);
  }
  const unique = (values) => [...new Map(values.map((value) => [`${value.name}\u0000${value.code ?? ''}`, value])).values()];
  return {
    include: unique(include),
    exclude: unique(exclude),
    unresolved: ambiguous ? [{ field: 'originDepartmentName', term: selectedTerms.map(({ term }) => term).join('、'), reason: 'ambiguous' }] : [],
    matchedTerms: selectedTerms.map(({ term }) => term),
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
  const organization = resolveOrganizationConditions(normalized, records, context.organization ?? null);
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
    + (organization?.include?.length ? 1 : 0) + (organization?.exclude?.length ? 1 : 0);
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
    return matchedTerms.every((term) => name.includes(normalizedOrganizationValue(term)));
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
    if (query.organization?.include?.length && !matchesOrganizationScope(record, query.organization.include, query.organization.matchedTerms)) continue;
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

function removeDimensions(question, structured) {
  const normalized = question.normalize('NFKC');
  const remove = {};
  if (structured.organization?.include?.length || structured.organization?.exclude?.length
    || /(?:工場|本社|事業所|センター|研究所|部署|部門|組織)指定/u.test(normalized)) remove.organization = true;
  if (/(?:件数|表示件数|件だけ|件に)/u.test(normalized)) remove.limit = true;
  if (/(?:並び|順番|直近|最新|最近)/u.test(normalized)) remove.sort = true;
  if (/(?:工程|現象|原因|処置|対応|設備|機械)(?:の)?指定(?:を)?(?:外して|解除して|なしにして)/u.test(normalized)) {
    remove.semanticFields = [];
    if (/工程/u.test(normalized)) remove.semanticFields.push('process');
    if (/現象/u.test(normalized)) remove.semanticFields.push('phenomenon');
    if (/(?:原因)/u.test(normalized)) remove.semanticFields.push('cause');
    if (/(?:処置|対応)/u.test(normalized)) remove.semanticFields.push('treatment');
  }
  return remove;
}

function deltaAction(question, evaluated, previousState) {
  if (!previousState || previousState.revision === 0) return 'new_search';
  const lexicalAction = explicitNewSearch(question)
    ? 'new_search'
    : explicitRemoval(question)
      ? 'remove_condition'
      : explicitReplacement(question)
        ? 'replace_condition'
        : isCorrectionFeedback(question)
          ? 'correct_condition'
          : null;
  const action = evaluated?.query?.changeAction;
  if (!['add_condition', 'replace_condition', 'remove_condition', 'correct_condition', 'new_search'].includes(action)) return null;
  return lexicalAction && lexicalAction !== action ? null : action;
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

function buildSearchDelta(question, evaluated, structured, previousState) {
  const action = deltaAction(question, evaluated, previousState);
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
      ...(evaluated.query?.unresolved ?? []),
      ...(structured.unresolved ?? []),
      ...(action ? [] : [{ kind: 'action', field: 'changeAction', term: question, reason: 'change_intent_unresolved' }]),
    ],
  };
  const requestedDisplay = evaluated.query?.display ?? displayRequestFrom(question, evaluated.judgments ?? {});
  if (appliedAction === 'new_search' || requestedDisplay.requested?.length) delta.display = requestedDisplay;
  const unsupportedSource = normalized.match(/(?:設備点検|計測機器|作業要領書|作業要領|要領書)/u)?.[0];
  if (unsupportedSource) {
    delta.unresolvedConditions.push({ kind: 'source', field: 'source', term: unsupportedSource, reason: 'source_not_connected_in_this_milestone' });
  }
  const limit = explicitLimitFromQuestion(normalized);
  if (limit !== null) delta.limit = limit;
  if (hasRecentRequest(normalized)) delta.sort = { field: 'discoveredOn', direction: 'desc' };
  if (appliedAction === 'remove_condition') {
    delta.remove = removeDimensions(normalized, structured);
    if (Object.keys(delta.remove).length === 0) {
      delta.unresolvedConditions.push({ kind: 'action', field: 'remove', term: question, reason: 'condition_to_remove_unresolved' });
    }
    if (delta.remove.organization) delta.exact.organization = undefined;
    if (delta.remove.limit) delta.limit = undefined;
    if (delta.remove.sort) delta.sort = undefined;
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
  const result = await evaluate({
    model: 'typesafe-ai/jev',
    state: mode === 'query' ? queryConversationState(question, conversation) : { request: question, relatedHistory: [], confirmationPending: null },
    questions: buildQuestions(definition, mode),
    maxRetries: 0
  });
  const evaluated = classificationFromAnswers(result?.answers, definition, mode, question);
  return { ...evaluated, response: result?.response ?? null, usage: result?.usage ?? null };
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
    const conversationTarget = previousState.revision > 0 ? 'previous_search' : 'new_search';
    const evaluated = await classifyText(question, this.definition, async (input) => {
      const callStarted = performance.now();
      const result = await this.evaluateImplementation(input);
      this.calls.push({ phase: 'query', requestSha256: sha256(question), questionCount: Object.keys(input.questions).length, elapsedMs: Number((performance.now() - callStarted).toFixed(3)) });
      return result;
    }, 'query', {
      ...safeConversation,
    searchRequest: previousState.revision > 0 ? null : safeConversation.searchRequest,
      conversationTarget,
      searchState: previousState,
    });
    const coverage = this.coverage();
    const structured = extractStructuredConditions(question, this.store.records, { organization: previousState.exact.organization });
    const delta = buildSearchDelta(question, evaluated, structured, previousState);
    const deltaDigest = deltaFingerprint(delta);
    const allUnresolved = delta.unresolvedConditions ?? [];
    const unresolvedLabels = allUnresolved.map((item) => {
      if (item.kind === undefined) return `起因部署の範囲: ${item.term}`;
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
    if (allUnresolved.length || conditionCount === 0 || displayOnly) {
      const nextPending = allUnresolved.length
        ? {
          request: question,
          question: `次の検索条件の意味を確認してください: ${unresolvedLabels.join('、')}`,
          purpose: 'resolve_search_condition',
          requiredItems: allUnresolved.map((item) => ({
            id: item.kind === undefined ? `structured:organization:${item.term}` : `${item.kind}:${item.groupId}:${item.optionId}`,
            label: item.kind === undefined ? '起因部署の範囲' : this.definition.groups.find((group) => group.id === item.groupId)?.label ?? item.groupId,
            type: item.kind === undefined ? 'choice' : item.kind,
            candidates: item.kind === undefined ? [] : [item.optionId],
          })),
          confirmedInfo: { ...structured.include, organization: structured.organization },
          unresolvedItems: allUnresolved.map((item) => item.kind === undefined ? `structured:organization:${item.term}` : `${item.kind}:${item.groupId}:${item.optionId}`),
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
      confirmationPending: pending,
      classifier: {
        classification: evaluated.classification,
        conditions: nextState.exact.include,
        exclude: nextState.exact.exclude,
        organization: nextState.exact.organization,
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
