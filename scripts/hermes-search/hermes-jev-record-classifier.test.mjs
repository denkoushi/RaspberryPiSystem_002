import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuthorizedRecordClassifier, buildClassificationDefinition, extractStructuredConditions } from './hermes-jev-record-classifier.mjs';
import { applySearchDelta, emptySearchState, exactSearchArguments } from './hermes-search-state.mjs';
import { evaluateAmbiguityImpact, RESOLUTION_ACTIONS } from './hermes-resolution-policy.mjs';

const snapshot = {
  schema: 'hermes-qmd-snapshot/v1',
  records: [
    {
      id: 'real-1', nonconformityNo: '00010001', partNumber: 'PART-1', partName: '軸', machineName: '旋盤A',
      originDepartmentName: '機械課', discoveredOn: '2026-09-19', condition: '旋盤加工で外径が上限を超過',
      remarks: '寸法不適合', correctiveContent: '再加工を実施', disposition: '選別して隔離'
    },
    {
      id: 'real-2', nonconformityNo: '00010002', partNumber: 'PART-2', partName: '板', machineName: 'フライスB',
      originDepartmentName: '組立課', discoveredOn: '2026-09-01', condition: '側面に打痕',
      remarks: null, correctiveContent: null, disposition: '交換'
    }
  ]
};

test('evaluates ambiguity by search impact instead of confirming every ambiguous value', () => {
  assert.deepEqual(evaluateAmbiguityImpact({
    ambiguity: { reason: 'candidate_set' },
    candidateSetSafe: true,
  }), { action: RESOLUTION_ACTIONS.CONTINUE_SET, reason: 'candidate_set_preserves_reading_intent' });
  assert.deepEqual(evaluateAmbiguityImpact({
    ambiguity: { reason: 'candidate_set' },
    candidateSetSafe: true,
    existingCondition: true,
  }), { action: RESOLUTION_ACTIONS.RESOLVE_EXISTING, reason: 'existing_condition_limits_scope' });
  assert.deepEqual(evaluateAmbiguityImpact({
    ambiguity: { reason: 'different_interpretations' },
  }), { action: RESOLUTION_ACTIONS.CONFIRM, reason: 'interpretation_changes_search_scope' });
  assert.deepEqual(evaluateAmbiguityImpact({
    ambiguity: { reason: 'not_found' },
  }), { action: RESOLUTION_ACTIONS.CONFIRM, reason: 'meaning_unresolved' });
});

function choiceAnswer(choice, options) {
  const otherProbability = options.length > 1 ? 0.06 / (options.length - 1) : 0;
  const probabilities = Object.fromEntries(options.map((option) => [option, option === choice ? 0.94 : otherProbability]));
  return { type: 'choice', choice, probabilities, confidence: 0.94 };
}

function noulAnswer(noul) {
  return { type: 'noul', noul };
}

function evaluator({ state, questions }) {
  const request = state.request;
  const isQuery = Object.keys(questions).some((key) => key.startsWith('include:'));
  const answers = {};
  for (const key of Object.keys(questions)) {
    const options = Object.keys(questions[key].criteria ?? {});
    if (key === 'conversation_target') {
      answers[key] = choiceAnswer(state.conversationTarget === 'previous_search' ? 'same_target' : '__none_requested__' in questions[key].criteria ? 'no_prior_target' : 'new_search', options);
    } else if (key === 'removal_target') {
      const target = /工場/u.test(request) ? 'organization_facility'
        : /部署/u.test(request) ? 'organization_department'
          : /工程/u.test(request) ? 'semantic:process'
            : /品番/u.test(request) ? 'exact:partNumber'
              : /機械/u.test(request) ? 'exact:machineName'
                : /件数/u.test(request) ? 'limit' : '__none_requested__';
      answers[key] = choiceAnswer(options.includes(target) ? target : '__none_requested__', options);
    } else if (key === 'change_action') {
      const selected = state.conversationTarget !== 'previous_search' || /新しく|新規に|別の|別件/u.test(request)
        ? 'new_search'
        : /外して|解除して|指定なし/u.test(request)
          ? 'remove_condition'
          : /に変えて|に変更して|切り替えて|置き換えて/u.test(request)
            ? 'replace_condition'
            : /混ざ|混在|違(?:う|って)|誤(?:り|って)|訂正|正しく/u.test(request)
              ? 'correct_condition'
              : /組立|旋盤|フライス|上限|打痕|再加工|隔離|交換|工場|課|件|直近|最新|最近|発生日|発見日|日付/u.test(request)
                ? 'add_condition'
                : 'clarify';
      answers[key] = choiceAnswer(selected, options);
    } else if (key.startsWith('display:')) {
      const displayKey = key.slice('display:'.length);
      const requested = (displayKey === 'discoveredOn' && /発生日|発見日|日付/u.test(request))
        || (displayKey === 'treatment' && /処置|処理|再加工|対応/u.test(request))
        || (displayKey === 'originalText' && /原文|原記録/u.test(request));
      answers[key] = noulAnswer(requested ? 0.96 : 0.01);
    } else if (isQuery && key.includes(':')) {
      const [polarity, group, option] = key.split(':');
      let requested = false;
      if (group === 'phenomenon' && option === 'oversize') requested = /上限|寸法/u.test(request);
      if (group === 'phenomenon' && option === 'surface_damage') requested = /打痕/u.test(request);
      if (group === 'treatment' && option === 'rework') requested = /再加工/u.test(request);
      if (group === 'treatment' && option === 'segregate') requested = /隔離/u.test(request);
      if (group === 'treatment' && option === 'repair_or_replace') requested = /交換/u.test(request);
      if (polarity === 'exclude') requested = requested && /除く|除外|以外/u.test(request);
      answers[key] = noulAnswer(requested ? 0.96 : 0.01);
    } else if (key === 'process') {
      const selected = isQuery
        ? (request.includes('組立') ? 'assembly' : request.includes('旋盤') ? 'turning' : request.includes('フライス') ? 'milling' : '__none_requested__')
        : (request.includes('組立') ? 'assembly' : request.includes('旋盤') ? 'turning' : request.includes('フライス') ? 'milling' : 'unknown');
      answers[key] = choiceAnswer(selected, options);
    } else if (key === 'dimension_direction') {
      const selected = request.includes('上限') || request.includes('超過')
        ? 'oversize'
        : request.includes('下限') || request.includes('小さい') || request.includes('不足')
          ? 'undersize'
          : isQuery ? '__none_requested__' : 'not_applicable';
      answers[key] = choiceAnswer(selected, options);
    } else if (key === 'cause_status') {
      const selected = request.includes('原因：') ? 'cause_recorded' : request.includes('原因なし') ? 'cause_not_recorded' : isQuery ? '__none_requested__' : 'unknown';
      answers[key] = choiceAnswer(selected, options);
    } else if (key === 'treatment_status') {
      const selected = request.includes('処置なし') ? 'treatment_not_recorded' : request.includes('処置が記載') ? 'treatment_recorded' : isQuery ? '__none_requested__' : (request.includes('再加工') || request.includes('処置') || request.includes('交換') ? 'treatment_recorded' : 'unknown');
      answers[key] = choiceAnswer(selected, options);
    } else if (key.includes(':')) {
      const [, option] = key.split(':');
      const requested = option === 'oversize' ? /上限|寸法/u.test(request)
        : option === 'surface_damage' ? /打痕/u.test(request)
          : option === 'rework' ? /再加工/u.test(request)
            : option === 'segregate' ? /隔離/u.test(request)
              : option === 'repair_or_replace' ? /交換/u.test(request)
                : false;
      answers[key] = noulAnswer(requested ? 0.96 : 0.01);
    } else {
      answers[key] = choiceAnswer(options.includes('unknown') ? 'unknown' : options[0], options);
    }
  }
  return Promise.resolve({ answers });
}

test('SearchState reducer keeps unspecified dimensions and distinguishes correction', () => {
  const first = applySearchDelta(emptySearchState(), {
    action: 'new_search',
    semantic: { include: { process: 'assembly' }, exclude: {} },
    unresolvedConditions: [],
  });
  const narrowed = applySearchDelta(first, {
    action: 'add_condition',
    exact: { include: {}, exclude: {}, organization: {
      include: [{ name: '三島工場組立課', code: 'M-1' }], exclude: [], matchedTerms: ['三島工場'], status: 'resolved'
    } },
    semantic: { include: {}, exclude: {} },
    unresolvedConditions: [],
  });
  const corrected = applySearchDelta(narrowed, {
    action: 'correct_condition',
    semantic: { include: {}, exclude: {} },
    unresolvedConditions: [],
  });
  assert.equal(corrected.semantic.include.process, 'assembly');
  assert.deepEqual(corrected.exact.organization.include.map((value) => value.name), ['三島工場組立課']);
  assert.equal(corrected.lastAction, 'correct_condition');
});

test('correct_condition replaces only the explicitly corrected fields', () => {
  const first = applySearchDelta(emptySearchState(), {
    action: 'new_search',
    exact: {
      include: { partName: '旧品名' },
      exclude: {},
      organization: { include: [{ name: '工場A' }], exclude: [], matchedTerms: ['工場A'], status: 'resolved' },
    },
    semantic: { include: { process: 'assembly', phenomenon: ['surface_damage'] }, exclude: {} },
    unresolvedConditions: [],
  });
  const corrected = applySearchDelta(first, {
    action: 'correct_condition',
    exact: {
      include: { partName: '新品名' },
      exclude: {},
      organization: { include: [{ name: '工場B' }], exclude: [], matchedTerms: ['工場B'], status: 'resolved' },
    },
    semantic: { include: { phenomenon: ['crack_or_breakage'] }, exclude: {} },
    unresolvedConditions: [],
  });
  assert.deepEqual(corrected.exact.include, { partName: '新品名' });
  assert.deepEqual(corrected.exact.organization.matchedTerms, ['工場B']);
  assert.deepEqual(corrected.semantic.include, { process: 'assembly', phenomenon: ['crack_or_breakage'] });
});

test('replacement patches only named fields and does not clear an unspecified organization', () => {
  const first = applySearchDelta(emptySearchState(), {
    action: 'new_search',
    exact: {
      include: { partName: '軸' },
      exclude: {},
      organization: { include: [{ name: '三島工場製造部機械課', code: 'M-1' }], exclude: [], matchedTerms: ['三島工場', '機械課'], status: 'resolved' },
    },
    semantic: { include: { process: 'assembly', phenomenon: ['surface_damage'] }, exclude: {} },
    unresolvedConditions: [],
  });
  const replaced = applySearchDelta(first, {
    action: 'replace_condition',
    exact: { include: {}, exclude: {} },
    semantic: { include: { cause: ['equipment_failure'] }, exclude: {} },
    unresolvedConditions: [],
  });
  assert.deepEqual(replaced.exact.include, { partName: '軸' });
  assert.deepEqual(replaced.exact.organization.matchedTerms, ['三島工場', '機械課']);
  assert.deepEqual(replaced.semantic.include, {
    process: 'assembly', phenomenon: ['surface_damage'], cause: ['equipment_failure'],
  });

  const exactOnly = applySearchDelta(emptySearchState(), {
    action: 'new_search',
    exact: {
      include: { partName: '軸', machineName: '旋盤A' },
      exclude: {},
      organization: { include: [{ name: '三島工場製造部機械課', code: 'M-1' }], exclude: [], matchedTerms: ['三島工場', '機械課'], status: 'resolved' },
    },
    semantic: { include: {}, exclude: {} },
    unresolvedConditions: [],
  });
  assert.deepEqual(exactSearchArguments(exactOnly), {
    kind: 'nonconformity', limit: 20, partName: '軸', machineName: '旋盤A',
    originDepartmentNameAny: ['三島工場'], originDepartmentName: '機械課',
  });
});

test('exact exclusion remains on the live search plan', () => {
  const state = applySearchDelta(emptySearchState(), {
    action: 'new_search',
    exact: {
      include: {},
      exclude: { partName: '旧品名' },
      organization: { include: [], exclude: [{ name: '工場B' }], matchedTerms: [], status: 'resolved' },
    },
    semantic: { include: {}, exclude: {} },
    unresolvedConditions: [],
  });
  assert.deepEqual(exactSearchArguments(state), {
    kind: 'nonconformity', limit: 20,
    exactExclude: { partName: '旧品名' },
    excludeOriginDepartmentNames: ['工場B'],
  });
});

test('conversation updates keep process, add facility, and do not invert a correction', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-search-state-conversation-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const stateSnapshot = {
    ...snapshot,
    records: [
      { ...snapshot.records[0], id: 'mishima-assembly-1', nonconformityNo: '00010201', originDepartmentCode: 'M-A', originDepartmentName: '三島工場組立課', condition: '組立工程で不適合', discoveredOn: '2026-09-20' },
      { ...snapshot.records[0], id: 'mishima-assembly-2', nonconformityNo: '00010202', originDepartmentCode: 'M-A', originDepartmentName: '三島工場組立課', condition: '組立工程で別の不適合', discoveredOn: '2026-09-19' },
      { ...snapshot.records[0], id: 'sendai-assembly', nonconformityNo: '00010203', originDepartmentCode: 'S-A', originDepartmentName: '仙台工場組立課', condition: '組立工程で不適合', discoveredOn: '2026-09-21' },
    ],
  };
  await writeFile(snapshotPath, JSON.stringify(stateSnapshot));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await classifier.prepare();
  const first = await classifier.answer('組立工程の原因と処置');
  assert.deepEqual(first.searchState.semantic.include, { process: 'assembly' });
  const second = await classifier.answer('三島工場だけにしぼって', first.session);
  assert.deepEqual(second.recordIds, ['nonconformity:mishima-assembly-1', 'nonconformity:mishima-assembly-2']);
  assert.equal(second.searchState.semantic.include.process, 'assembly');
  assert.deepEqual(second.searchState.exact.organization.matchedTerms, ['三島工場']);
  const unclear = await classifier.answer('もう少し', second.session);
  assert.equal(unclear.status, 'clarification');
  assert.equal(unclear.searchDelta.action, 'clarify');
  assert.equal(unclear.searchState.revision, second.searchState.revision);
  const third = await classifier.answer('組立工程以外が混ざってるけど', second.session);
  assert.deepEqual(third.recordIds, second.recordIds);
  assert.equal(third.searchState.semantic.include.process, 'assembly');
  assert.deepEqual(third.searchState.semantic.exclude, {});
  assert.equal(third.searchDelta.action, 'correct_condition');
  const replaced = await classifier.answer('仙台工場に変えて', third.session);
  assert.deepEqual(replaced.recordIds, ['nonconformity:sendai-assembly']);
  assert.equal(replaced.searchState.semantic.include.process, 'assembly');
  assert.equal(replaced.searchDelta.action, 'replace_condition');
  const unrestricted = await classifier.answer('工場指定を外して', replaced.session);
  assert.deepEqual(unrestricted.recordIds, [
    'nonconformity:mishima-assembly-1', 'nonconformity:mishima-assembly-2', 'nonconformity:sendai-assembly'
  ]);
  assert.equal(unrestricted.searchState.exact.organization.include.length, 0);
  const unresolved = await classifier.answer('架空工場だけにして', unrestricted.session);
  assert.equal(unresolved.status, 'clarification');
  assert.equal(unresolved.searchState.revision, unrestricted.searchState.revision);
  const newSource = await classifier.answer('新しく設備点検を探したい', unrestricted.session);
  assert.equal(newSource.status, 'clarification');
  assert.equal(newSource.searchState.revision, unrestricted.searchState.revision);
});

test('exact facility and recent limit use all current records even when classification is absent', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-exact-unclassified-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const exactSnapshot = {
    ...snapshot,
    records: [
      { ...snapshot.records[0], id: 'mishima-new', nonconformityNo: '00010301', originDepartmentName: '三島工場品質課', discoveredOn: '2026-09-21' },
      { ...snapshot.records[0], id: 'mishima-old', nonconformityNo: '00010302', originDepartmentName: '三島工場品質課', discoveredOn: '2026-09-20' },
      { ...snapshot.records[0], id: 'sendai', nonconformityNo: '00010303', originDepartmentName: '仙台工場品質課', discoveredOn: '2026-09-22' },
    ],
  };
  await writeFile(snapshotPath, JSON.stringify(exactSnapshot));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, classificationEnabled: false, evaluateImplementation: evaluator });
  await classifier.prepare();
  const result = await classifier.answer('三島工場の不適合２件。直近');
  assert.deepEqual(result.recordIds, ['nonconformity:mishima-new', 'nonconformity:mishima-old']);
  assert.equal(result.searchPlan.mode, 'exact');
  assert.deepEqual(exactSearchArguments(result.searchState), {
    kind: 'nonconformity', limit: 2, originDepartmentNameAny: ['三島工場'],
  });
});

test('classifies real snapshot rows incrementally and refuses unbound display-only questions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-real-classifier-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const first = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  const firstRuntime = await first.prepare();
  assert.equal(firstRuntime.recordCount, 2);
  assert.equal(firstRuntime.classifiedRecordCount, 2);
  assert.equal(firstRuntime.reusedRecordCount, 0);
  const matched = await first.answer('旋盤加工で寸法が上限を超えた不適合の処置を確認したい。');
  assert.equal(matched.status, 'completed');
  assert.deepEqual(matched.recordIds, ['nonconformity:real-1']);
  assert.match(matched.answer, /再加工を実施/);
  const semanticExclusion = await first.answer('再加工以外の寸法が上限を超えた不適合');
  assert.deepEqual(semanticExclusion.recordIds, []);
  const department = await first.answer('機械課の最近の不適合');
  assert.deepEqual(department.recordIds, ['nonconformity:real-1']);
  const excluded = await first.answer('機械課を除く不適合');
  assert.deepEqual(excluded.recordIds, ['nonconformity:real-2']);
  const unbound = await first.answer('発生日は');
  assert.equal(unbound.status, 'clarification');
  assert.deepEqual(unbound.recordIds, []);
  const dated = await first.answer('発生日は2026年9月19日の不適合');
  assert.deepEqual(dated.recordIds, ['nonconformity:real-1']);

  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(persisted.records.length, 2);
  assert.equal(persisted.classifications.length, 2);
  assert.equal(persisted.classifications[0].judgments.process.type, 'choice');
  assert.equal(persisted.classifications[0].classification.dimension_direction, 'oversize');
  assert.equal(persisted.classifications[0].judgments.dimension_direction.type, 'choice');
  assert.ok(!JSON.stringify(persisted.classifications).includes('旋盤加工で外径が上限を超過'));
  assert.ok(!persisted.definition.groups.find((group) => group.id === 'observed_topic').options.some((option) => option.observedTerm === 'PART'));

  const second = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: () => { throw new Error('unchanged rows must not be sent to JEV'); } });
  const secondRuntime = await second.prepare();
  assert.equal(secondRuntime.classifiedRecordCount, 0);
  assert.equal(secondRuntime.reusedRecordCount, 2);

  await writeFile(snapshotPath, JSON.stringify({
    ...snapshot,
    records: [...snapshot.records, {
      id: 'real-3', nonconformityNo: '00010003', partNumber: 'PART-3', partName: '軸受', machineName: '検査C',
      originDepartmentName: '品質保証課', discoveredOn: '2026-09-20', condition: '刻印が一部欠落',
      remarks: '識別情報の不備', correctiveContent: null, disposition: '設計へ確認依頼'
    }]
  }));
  let thirdCalls = 0;
  const third = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: async (input) => {
    thirdCalls += 1;
    return evaluator(input);
  } });
  const thirdRuntime = await third.prepare();
  assert.equal(thirdRuntime.classifiedRecordCount, 3);
  assert.equal(thirdRuntime.reusedRecordCount, 0);
  assert.equal(thirdCalls, 3);
});

test('removes an exact machine condition without treating it as a semantic field', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-exact-removal-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await classifier.prepare();
  const machine = await classifier.answer('旋盤Aの不適合');
  assert.equal(machine.searchState.exact.include.machineName, '旋盤A');
  const removed = await classifier.answer('機械指定を外して', machine.session);
  assert.equal(removed.searchState.exact.include.machineName, undefined);
  assert.equal(removed.searchDelta.action, 'remove_condition');
});

test('resolves a facility term to its recorded origin-department scope and applies recent limit in code', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-organization-scope-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const organizationSnapshot = {
    ...snapshot,
    records: [
      { ...snapshot.records[0], id: 'north-machine', nonconformityNo: '00010101', originDepartmentCode: 'N-M', originDepartmentName: '北工場製造部機械課', discoveredOn: '2026-09-20' },
      { ...snapshot.records[0], id: 'north-quality', nonconformityNo: '00010102', originDepartmentCode: 'N-Q', originDepartmentName: '北工場品質保証課', discoveredOn: '2026-09-19' },
      { ...snapshot.records[0], id: 'north-old', nonconformityNo: '00010103', originDepartmentCode: 'N-M', originDepartmentName: '北工場製造部機械課', discoveredOn: '2026-09-18' },
      { ...snapshot.records[1], id: 'south-machine', nonconformityNo: '00010104', originDepartmentCode: 'S-M', originDepartmentName: '南工場製造部機械課', discoveredOn: '2026-09-21' },
    ],
  };
  const extracted = extractStructuredConditions('北工場の不適合２件。直近', organizationSnapshot.records);
  assert.deepEqual(extracted.unresolved, []);
  assert.deepEqual(extracted.organization.include.map((value) => value.name).sort(), [
    '北工場品質保証課', '北工場製造部機械課',
  ]);

  await writeFile(snapshotPath, JSON.stringify(organizationSnapshot));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await classifier.prepare();
  const result = await classifier.answer('北工場の不適合２件。直近');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.recordIds, ['nonconformity:north-machine', 'nonconformity:north-quality']);
  assert.equal(result.classifier.limit, 2);
  assert.deepEqual(result.classifier.organization.matchedTerms, ['北工場']);

  const sameFormalDepartment = extractStructuredConditions('機械課の不適合', organizationSnapshot.records);
  assert.deepEqual(sameFormalDepartment.unresolved, []);
  assert.equal(sameFormalDepartment.organization.resolution.action, RESOLUTION_ACTIONS.CONTINUE_SET);
  assert.deepEqual(sameFormalDepartment.organization.include.map((value) => value.name).sort(), [
    '北工場製造部機械課', '南工場製造部機械課',
  ]);
  const scoped = extractStructuredConditions('機械課の不適合', organizationSnapshot.records, {
    organization: {
      include: [{ name: '北工場製造部機械課', code: 'N-M' }, { name: '北工場品質保証課', code: 'N-Q' }],
      exclude: [], matchedTerms: ['北工場'], status: 'resolved',
    },
  });
  assert.deepEqual(scoped.unresolved, []);
  assert.equal(scoped.organization.resolution.action, RESOLUTION_ACTIONS.RESOLVE_EXISTING);
  assert.deepEqual(scoped.organization.include.map((value) => value.name), ['北工場製造部機械課']);
  const unknown = extractStructuredConditions('架空工場の不適合', organizationSnapshot.records);
  assert.equal(unknown.unresolved[0].reason, 'not_found');
  assert.equal(unknown.organization.resolution.action, RESOLUTION_ACTIONS.CONFIRM);
});

test('keeps a factory scope while resolving a new department and removes only the factory scope', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-organization-set-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const organizationSnapshot = {
    ...snapshot,
    records: [
      { ...snapshot.records[0], id: 'north-machine', nonconformityNo: '00010401', originDepartmentCode: 'N-M', originDepartmentName: '北工場製造部機械課', discoveredOn: '2026-09-20' },
      { ...snapshot.records[0], id: 'north-material', nonconformityNo: '00010402', originDepartmentCode: 'N-S', originDepartmentName: '北工場資材課', discoveredOn: '2026-09-21' },
      { ...snapshot.records[0], id: 'south-material', nonconformityNo: '00010403', originDepartmentCode: 'S-S', originDepartmentName: '南工場資材課', discoveredOn: '2026-09-22' },
    ],
  };
  await writeFile(snapshotPath, JSON.stringify(organizationSnapshot));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, classificationEnabled: false, evaluateImplementation: evaluator });
  await classifier.prepare();

  const factory = await classifier.answer('北工場の不適合');
  assert.deepEqual(factory.searchState.exact.organization.matchedTerms, ['北工場']);

  const department = await classifier.answer('資材課の最近の不適合1件', factory.session);
  assert.deepEqual(department.recordIds, ['nonconformity:north-material']);
  assert.deepEqual(department.searchState.exact.organization.matchedTerms, ['北工場', '資材課']);
  assert.deepEqual(exactSearchArguments(department.searchState), {
    kind: 'nonconformity', limit: 1, originDepartmentNameAny: ['北工場'], originDepartmentName: '資材課',
  });

  const unrestricted = await classifier.answer('工場指定を外して', department.session);
  assert.deepEqual(unrestricted.recordIds, ['nonconformity:south-material']);
  assert.deepEqual(unrestricted.searchState.exact.organization.matchedTerms, ['資材課']);
  assert.deepEqual(exactSearchArguments(unrestricted.searchState), {
    kind: 'nonconformity', limit: 1, originDepartmentName: '資材課',
  });

  const explicitFactoryRemoval = await classifier.answer('北工場を外して', department.session);
  assert.deepEqual(explicitFactoryRemoval.recordIds, ['nonconformity:south-material']);
  assert.deepEqual(explicitFactoryRemoval.searchState.exact.organization.matchedTerms, ['資材課']);

  const namedScopeRemoval = await classifier.answer('北工場の指定を解除して', department.session);
  assert.deepEqual(namedScopeRemoval.searchState.exact.organization.matchedTerms, ['資材課']);
  assert.deepEqual(namedScopeRemoval.recordIds, ['nonconformity:south-material']);
  assert.equal(namedScopeRemoval.searchDiagnostics.conditionChange.operationJudgment.choice, 'remove_condition');
  assert.equal(namedScopeRemoval.searchDiagnostics.conditionChange.targetJudgment.choice, 'organization_facility');
  assert.deepEqual(namedScopeRemoval.searchDiagnostics.conditionChange.remove, { organizationFacility: true });
  assert.equal(namedScopeRemoval.searchDiagnostics.conditionChange.resolutionImpact.action, RESOLUTION_ACTIONS.CONTINUE_SET);

  const compound = await classifier.answer('北工場資材課の不適合');
  const compoundRemoval = await classifier.answer('工場指定を外して', compound.session);
  assert.deepEqual(compoundRemoval.recordIds, ['nonconformity:north-material', 'nonconformity:south-material']);
  assert.deepEqual(compoundRemoval.searchState.exact.organization.matchedTerms, ['資材課']);

  const eitherFactory = await classifier.answer('北工場または南工場の資材課の直近2件');
  assert.deepEqual(eitherFactory.recordIds, ['nonconformity:south-material', 'nonconformity:north-material']);
  assert.deepEqual(eitherFactory.searchState.exact.organization.matchedTerms, ['北工場', '南工場', '資材課']);
  assert.deepEqual(exactSearchArguments(eitherFactory.searchState), {
    kind: 'nonconformity', limit: 2,
    originDepartmentNameAny: ['北工場', '南工場'], originDepartmentName: '資材課',
  });

  const sameFormalName = await classifier.answer('資材課の直近の不適合2件');
  assert.deepEqual(sameFormalName.recordIds, ['nonconformity:south-material', 'nonconformity:north-material']);
  const unknown = await classifier.answer('月面課の不適合');
  assert.equal(unknown.status, 'clarification');
  assert.equal(unknown.searchDelta.applied, false);
});

test('distinguishes source field labels from organization values after factory removal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-field-value-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const records = [
    { ...snapshot.records[0], id: 'material-mishima', originDepartmentName: '三島工場管理部資材課', originDepartmentCode: '110501051' },
    { ...snapshot.records[1], id: 'material-sendai', originDepartmentName: '仙台工場管理部資材課', originDepartmentCode: '110701052' },
    { ...snapshot.records[0], id: 'machine-sendai', originDepartmentName: '仙台工場製造部機械課', originDepartmentCode: 'machine' },
  ];
  const previous = {
    schema: 'hermes-search-state/v1', revision: 3, sources: ['nonconformity'],
    exact: { include: {}, exclude: {}, organization: {
      include: records.slice(0, 2).map((row) => ({ name: row.originDepartmentName, code: row.originDepartmentCode })),
      exclude: [], matchedTerms: ['資材課'], status: 'resolved',
    } },
    semantic: { include: {}, exclude: {} }, sort: { field: 'discoveredOn', direction: 'desc' },
    limit: 1, display: { originalText: true, requested: ['phenomenon'] },
    unresolvedConditions: [], lastAction: 'remove_condition',
  };
  const failedRequest = '起因部署が資材課の不適合を最新順で2件表示して';
  const structured = extractStructuredConditions(failedRequest, records, { organization: previous.exact.organization });
  assert.deepEqual(structured.unresolved, []);
  assert.deepEqual(structured.organization.matchedTerms, ['資材課']);
  assert.equal(structured.organization.resolution.action, RESOLUTION_ACTIONS.CONTINUE_SET);
  for (const request of ['資材課の不適合を最新順で2件表示して', '起因部署：資材課の最近の不適合2件']) {
    assert.deepEqual(extractStructuredConditions(request, records).organization, structured.organization);
  }
  assert.deepEqual(extractStructuredConditions('起因部署が機械課の不適合', records).organization.matchedTerms, ['機械課']);
  const display = extractStructuredConditions('その記録の起因部署を表示して', records);
  assert.deepEqual(display.unresolved, []);
  assert.deepEqual(display.organization.include, []);
  for (const request of ['起因部署が月面課の不適合', '起因部署が起因部の不適合', '機械名課の不適合']) {
    const unknown = extractStructuredConditions(request, records);
    assert.equal(unknown.unresolved[0].reason, 'not_found');
    assert.equal(unknown.organization.resolution.action, RESOLUTION_ACTIONS.CONFIRM);
  }
  await writeFile(snapshotPath, JSON.stringify({ ...snapshot, records }));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath: path.join(directory, 'classifications.json'), classificationEnabled: false, evaluateImplementation: evaluator });
  await classifier.prepare();
  const result = await classifier.answer(failedRequest, { searchState: previous });
  assert.equal(result.status, 'completed');
  assert.equal(result.searchDelta.applied, true);
  assert.deepEqual(result.searchState.exact.organization.matchedTerms, ['資材課']);
  assert.deepEqual(result.searchState.semantic, previous.semantic);
  assert.deepEqual(result.searchState.sort, previous.sort);
  assert.equal(result.searchState.limit, 2);
  assert.deepEqual(result.searchPlan.args, { kind: 'nonconformity', limit: 2, originDepartmentName: '資材課' });
  assert.deepEqual(result.recordIds, ['nonconformity:material-mishima', 'nonconformity:material-sendai']);
  assert.equal(classifier.calls.filter(({ phase }) => phase === 'record').length, 0);
});

test('selects a current removal target independently and preserves every other condition', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-removal-target-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  await writeFile(snapshotPath, JSON.stringify({ ...snapshot, records: [
    { ...snapshot.records[0], originDepartmentName: '仙台工場管理部資材課' },
    { ...snapshot.records[1], originDepartmentName: '三島工場管理部資材課' },
  ] }));
  let target = 'organization_facility';
  let confidence = 0.94;
  let evaluatedState;
  const classifier = new AuthorizedRecordClassifier({
    snapshotPath, storePath: path.join(directory, 'classifications.json'), classificationEnabled: false,
    evaluateImplementation: async (input) => {
      evaluatedState = input.state;
      const result = await evaluator(input);
      result.answers.change_action = choiceAnswer('remove_condition', Object.keys(input.questions.change_action.criteria));
      result.answers.removal_target = { ...choiceAnswer(target, Object.keys(input.questions.removal_target.criteria)), confidence };
      result.model = 'synthetic-contract-model';
      return result;
    },
  });
  await classifier.prepare();
  const organization = extractStructuredConditions('仙台工場の資材課', classifier.store.records).organization;
  const previous = applySearchDelta(emptySearchState(), {
    action: 'new_search', exact: { organization },
    semantic: { include: { process: 'turning' }, exclude: {} },
    limit: 2, sort: { field: 'discoveredOn', direction: 'desc' },
    display: { originalText: true, requested: ['originalText'] },
  });
  for (const question of ['仙台工場の指定を解除して', 'その拠点だけに限定するのはやめて']) {
    const result = await classifier.answer(question, { searchState: previous });
    assert.equal(result.searchDelta.action, 'remove_condition');
    assert.equal(result.searchDelta.applied, true);
    assert.deepEqual(result.searchState.exact.organization.matchedTerms, ['資材課']);
    assert.equal(result.searchState.exact.organization.include.length, 2);
    for (const field of ['semantic', 'limit', 'sort', 'display']) assert.deepEqual(result.searchState[field], previous[field]);
    assert.deepEqual(evaluatedState.searchState, previous);
    assert.deepEqual(evaluatedState.removalCandidates.find(({ id }) => id === 'organization_facility').values, ['仙台工場']);
    assert.deepEqual(evaluatedState.removalCandidates.find(({ id }) => id === 'organization_department').values, ['資材課']);
    assert.deepEqual(result.searchDiagnostics.conditionChange.remove, { organizationFacility: true });
    assert.equal(result.searchDiagnostics.conditionChange.rejectionReason, null);
    assert.equal(result.searchDiagnostics.conditionChange.model, 'synthetic-contract-model');
    assert.equal(result.searchDiagnostics.conditionChange.remainingConditionCount, 2);
  }
  target = 'organization_department';
  const withoutDepartment = await classifier.answer('部署の限定を解除して', { searchState: previous });
  assert.deepEqual(withoutDepartment.searchState.exact.organization.matchedTerms, ['仙台工場']);
  assert.deepEqual(withoutDepartment.searchState.semantic, previous.semantic);

  const factorySet = applySearchDelta(previous, {
    action: 'replace_condition', exact: { organization: extractStructuredConditions('仙台工場または三島工場の資材課', classifier.store.records).organization },
  });
  target = 'organization_facility:仙台工場';
  const withoutOneFactory = await classifier.answer('仙台工場の指定だけ解除して', { searchState: factorySet });
  assert.deepEqual(withoutOneFactory.searchState.exact.organization.matchedTerms, ['三島工場', '資材課']);
  for (const field of ['semantic', 'limit', 'sort', 'display']) assert.deepEqual(withoutOneFactory.searchState[field], factorySet[field]);
  target = 'organization_facility';
  const withoutFactories = await classifier.answer('工場の指定を全部解除して', { searchState: factorySet });
  assert.deepEqual(withoutFactories.searchState.exact.organization.matchedTerms, ['資材課']);

  const withExclusions = applySearchDelta(factorySet, {
    action: 'replace_condition', exact: { organization: { ...factorySet.exact.organization, exclude: factorySet.exact.organization.include } },
  });
  target = 'organization_exclude:0';
  const withoutOneExclusion = await classifier.answer('先に指定した組織の除外だけ解除して', { searchState: withExclusions });
  assert.deepEqual(withoutOneExclusion.searchState.exact.organization, {
    ...withExclusions.exact.organization, exclude: withExclusions.exact.organization.exclude.slice(1),
  });

  target = 'semantic:process';
  const withoutProcess = await classifier.answer('工程の指定を解除して', { searchState: previous });
  assert.deepEqual(withoutProcess.searchState.semantic.include, {});
  assert.deepEqual(withoutProcess.searchState.exact, previous.exact);
  assert.equal(withoutProcess.searchState.limit, 2);
  assert.deepEqual(withoutProcess.searchState.sort, previous.sort);

  target = 'limit';
  const withoutLimit = await classifier.answer('最新順のままで、件数指定を解除して', { searchState: previous });
  assert.equal(withoutLimit.searchState.limit, emptySearchState().limit);
  for (const field of ['exact', 'semantic', 'sort', 'display']) assert.deepEqual(withoutLimit.searchState[field], previous[field]);

  const multiplePhenomena = applySearchDelta(previous, {
    action: 'add_condition',
    semantic: { include: { phenomenon: ['surface_damage', 'missing_marking'] }, exclude: { phenomenon: ['crack_or_breakage'] } },
  });
  target = 'semantic:phenomenon:include:surface_damage';
  const withoutDamage = await classifier.answer('打痕を含む条件だけ解除して', { searchState: multiplePhenomena });
  assert.deepEqual(withoutDamage.searchState.semantic, {
    include: { process: 'turning', phenomenon: ['missing_marking'] }, exclude: { phenomenon: ['crack_or_breakage'] },
  });
  target = 'semantic:phenomenon:exclude:crack_or_breakage';
  const withoutExclusion = await classifier.answer('割れを除外する条件だけ解除して', { searchState: multiplePhenomena });
  assert.deepEqual(withoutExclusion.searchState.semantic, { include: multiplePhenomena.semantic.include, exclude: {} });
  for (const field of ['exact', 'limit', 'sort', 'display']) assert.deepEqual(withoutExclusion.searchState[field], multiplePhenomena[field]);
  target = 'semantic:phenomenon';
  const withoutPhenomena = await classifier.answer('現象の条件を全部解除して', { searchState: multiplePhenomena });
  assert.deepEqual(withoutPhenomena.searchState.semantic, previous.semantic);

  const exactPolarities = applySearchDelta(previous, {
    action: 'add_condition', exact: { include: { partNumber: 'PART-1' }, exclude: { partNumber: 'PART-2' } },
  });
  target = 'exact:partNumber:include:PART-1';
  const withoutIncludedPart = await classifier.answer('品番PART-1の指定だけ解除して', { searchState: exactPolarities });
  assert.deepEqual(withoutIncludedPart.searchState.exact, { ...exactPolarities.exact, include: {} });
  target = 'exact:partNumber:exclude:PART-2';
  const withoutExcludedPart = await classifier.answer('品番PART-2の除外指定だけ解除して', { searchState: exactPolarities });
  assert.deepEqual(withoutExcludedPart.searchState.exact, { ...exactPolarities.exact, exclude: {} });
  for (const field of ['semantic', 'limit', 'sort', 'display']) assert.deepEqual(withoutExcludedPart.searchState[field], exactPolarities[field]);

  for (const selection of [{ choice: '__none_requested__', confidence: 0.94 }, { choice: 'organization_facility', confidence: 0.2 }]) {
    target = selection.choice;
    confidence = selection.confidence;
    const unresolved = await classifier.answer('その条件を解除して', { searchState: previous });
    assert.equal(unresolved.status, 'clarification');
    assert.equal(unresolved.searchDelta.applied, false);
    assert.deepEqual(unresolved.searchState, previous);
    assert.equal(unresolved.searchDiagnostics.conditionChange.selectedTarget, null);
    assert.equal(unresolved.searchDiagnostics.conditionChange.rejectionReason, 'removal_target_unresolved');
    assert.ok(unresolved.confirmationPending.requiredItems.some(({ label }) => label === 'removalTarget'));
  }
  assert.equal(classifier.metrics().classificationCalls, 0);
  assert.equal(classifier.definition.version, 4);
});

test('starts with reusable classifications and persists each background result', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-real-classifier-background-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const started = [];
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: async (input) => {
    started.push(input.state.request);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return evaluator(input);
  } });
  const runtime = await classifier.prepare({ background: true });
  assert.equal(runtime.classificationStatus, 'running');
  assert.equal(runtime.classificationEnabled, true);
  assert.equal(runtime.pendingRecordCount, 2);
  assert.equal(started.length, 1);
  const checkpoint = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(checkpoint.classifications.length, 0);
  await classifier.classificationPromise;
  assert.equal(classifier.metrics().classificationStatus, 'complete');
  assert.equal(classifier.metrics().pending, 0);
  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(persisted.classifications.length, 2);
});

test('classification-off startup reads saved results without starting record JEV or rewriting the store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-record-classification-off-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const seeded = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await seeded.prepare();
  const before = await readFile(storePath, 'utf8');
  await writeFile(snapshotPath, JSON.stringify({
    ...snapshot,
    records: [...snapshot.records, {
      ...snapshot.records[0], id: 'real-3', nonconformityNo: '00010003'
    }],
  }));
  let recordCalls = 0;
  const disabled = new AuthorizedRecordClassifier({
    snapshotPath,
    storePath,
    classificationEnabled: false,
    evaluateImplementation: async (input) => {
      if (!Object.keys(input.questions).some((key) => key.startsWith('include:'))) recordCalls += 1;
      return evaluator(input);
    },
  });
  const runtime = await disabled.prepare({ background: true });
  assert.equal(runtime.classificationStatus, 'disabled');
  assert.equal(runtime.classificationEnabled, false);
  assert.equal(disabled.classificationPromise, null);
  assert.equal(recordCalls, 0);
  assert.deepEqual(disabled.coverage(), { total: 3, classified: 2, pending: 1, complete: false });
  assert.equal(await readFile(storePath, 'utf8'), before);

  const result = await disabled.answer('旋盤加工で寸法が上限を超えた不適合');
  assert.deepEqual(result.recordIds, ['nonconformity:real-1']);
  assert.match(result.answer, /事前分類は停止中です/);
  assert.doesNotMatch(result.answer, /分類処理中/);
  assert.equal(disabled.metrics().classificationCalls, 0);
  assert.ok(disabled.metrics().queryClassificationCalls > 0);

  const resumed = new AuthorizedRecordClassifier({
    snapshotPath,
    storePath,
    classificationEnabled: true,
    evaluateImplementation: async (input) => {
      if (!Object.keys(input.questions).some((key) => key.startsWith('include:'))) recordCalls += 1;
      return evaluator(input);
    },
  });
  const resumedRuntime = await resumed.prepare();
  assert.equal(resumedRuntime.classificationEnabled, true);
  assert.equal(resumedRuntime.classificationStatus, 'complete');
  assert.equal(resumedRuntime.classifiedRecordCount, 1);
  assert.equal(recordCalls, 1);
});

test('passes the existing conversation state into query classification', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-real-classifier-conversation-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  let queryState;
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: async (input) => {
    if (input.state.request.includes('続きの質問')) queryState = input.state;
    return evaluator(input);
  } });
  await classifier.prepare();
  await classifier.answer('続きの質問', {
    searchRequest: '機械課の不適合',
    relatedHistory: [{ role: 'assistant', content: '対象をもう少し具体化してください。' }],
    confirmationPending: { request: '機械課の不適合', unresolvedItems: ['対象'] },
  });
  assert.deepEqual(queryState.relatedHistory, [
    { role: 'user', content: '機械課の不適合' },
    { role: 'assistant', content: '対象をもう少し具体化してください。' },
  ]);
  assert.deepEqual(queryState.confirmationPending, { request: '機械課の不適合', unresolvedItems: ['対象'] });
});

test('uses semantic judgments without requiring a literal query term and keeps follow-up target state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-semantic-search-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const semanticSnapshot = {
    ...snapshot,
    records: [{
      id: 'semantic-1', nonconformityNo: '00010009', partNumber: 'PART-9', partName: '軸', machineName: '旋盤A',
      originDepartmentName: '機械課', discoveredOn: '2026-09-21', condition: '外径が上限を超過',
      remarks: null, correctiveContent: '再加工を実施', disposition: '選別して隔離'
    }]
  };
  await writeFile(snapshotPath, JSON.stringify(semanticSnapshot));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await classifier.prepare();
  const first = await classifier.answer('旋盤加工で寸法が上限を超えた不適合');
  assert.deepEqual(first.recordIds, ['nonconformity:semantic-1']);
  const followUp = await classifier.answer('その発生日は？', first.session);
  assert.equal(followUp.status, 'completed');
  assert.deepEqual(followUp.recordIds, ['nonconformity:semantic-1']);
  assert.equal(followUp.classifier.search.target, 'previous_search');
  assert.match(followUp.answer, /2026-09-21/);
});

test('does not convert an invalid judgment response into a negative classification', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-invalid-judgment-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const classifier = new AuthorizedRecordClassifier({
    snapshotPath,
    storePath,
    evaluateImplementation: async (input) => {
      const result = await evaluator(input);
      delete result.answers['phenomenon:surface_damage'];
      return result;
    },
  });
  const runtime = await classifier.prepare({ background: true });
  await classifier.classificationPromise;
  assert.equal(runtime.classificationStatus, 'partial');
  assert.equal(classifier.coverage().classified, 0);
  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(persisted.classifications.length, 0);
  assert.equal(persisted.pendingRecordIds.length, 2);
});

test('does not select an undersize record for an oversize query', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-dimension-direction-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const directionSnapshot = {
    ...snapshot,
    records: [
      { ...snapshot.records[0], id: 'direction-large', nonconformityNo: '00010011', condition: '外径が上限を超過' },
      { ...snapshot.records[1], id: 'direction-small', nonconformityNo: '00010012', condition: '指定寸法より小さい' },
    ],
  };
  await writeFile(snapshotPath, JSON.stringify(directionSnapshot));
  const classifier = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await classifier.prepare();
  const result = await classifier.answer('寸法が上限を超えた不適合の処置を確認したい。');
  assert.deepEqual(result.recordIds, ['nonconformity:direction-large']);
});

test('migrates only legacy dimension conflicts instead of reclassifying every saved row', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-dimension-migration-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const directionSnapshot = {
    ...snapshot,
    records: [
      { ...snapshot.records[0], id: 'migration-large', nonconformityNo: '00010021', condition: '外径が上限を超過' },
      { ...snapshot.records[1], id: 'migration-conflict', nonconformityNo: '00010022', condition: '寸法の記載が矛盾' },
    ],
  };
  await writeFile(snapshotPath, JSON.stringify(directionSnapshot));
  const seeded = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await seeded.prepare();
  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  const legacyDefinition = {
    ...persisted.definition,
    version: 3,
    groups: persisted.definition.groups
      .filter((group) => group.id !== 'dimension_direction')
      .map((group) => group.id === 'phenomenon'
        ? { ...group, options: [{ id: 'oversize', description: '寸法・形状が規格または上限を超えている' }, { id: 'undersize', description: '寸法・形状が規格または下限を下回っている' }, ...group.options] }
        : group),
  };
  const large = persisted.classifications.find((entry) => entry.id === 'migration-large');
  const conflict = persisted.classifications.find((entry) => entry.id === 'migration-conflict');
  const legacyEntry = (entry, direction) => ({
    id: entry.id,
    classification: {
      ...Object.fromEntries(Object.entries(entry.classification).filter(([key]) => key !== 'dimension_direction')),
      phenomenon: [...entry.classification.phenomenon, direction],
    },
    judgments: {
      ...entry.judgments,
      [`phenomenon:${direction}`]: { type: 'noul', noul: 0.9 },
      'phenomenon:oversize': { type: 'noul', noul: direction === 'oversize' ? 0.9 : 0.01 },
      'phenomenon:undersize': { type: 'noul', noul: direction === 'undersize' ? 0.9 : 0.01 },
    },
  });
  const conflictEntry = {
    ...legacyEntry(conflict, 'undersize'),
    classification: { ...legacyEntry(conflict, 'undersize').classification, phenomenon: [...conflict.classification.phenomenon, 'oversize', 'undersize'] },
    judgments: {
      ...legacyEntry(conflict, 'undersize').judgments,
      'phenomenon:oversize': { type: 'noul', noul: 0.9 },
    },
  };
  await writeFile(storePath, JSON.stringify({ ...persisted, definition: legacyDefinition, classifications: [legacyEntry(large, 'oversize'), conflictEntry] }));
  let calls = 0;
  const migrated = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: async (input) => { calls += 1; return evaluator(input); } });
  const runtime = await migrated.prepare();
  assert.equal(runtime.reusedRecordCount, 1);
  assert.equal(runtime.classifiedRecordCount, 1);
  assert.equal(calls, 1);
});

test('reclassifies a legacy tag that contradicts its stored Noul probability', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-dimension-contradiction-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  const contradictionSnapshot = {
    ...snapshot,
    records: [{ ...snapshot.records[0], id: 'migration-contradiction', nonconformityNo: '00010031', condition: '外径が上限を超過' }],
  };
  await writeFile(snapshotPath, JSON.stringify(contradictionSnapshot));
  const seeded = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  await seeded.prepare();
  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  const legacyDefinition = {
    ...persisted.definition,
    version: 3,
    groups: persisted.definition.groups
      .filter((group) => group.id !== 'dimension_direction')
      .map((group) => group.id === 'phenomenon'
        ? { ...group, options: [{ id: 'oversize', description: '寸法・形状が規格または上限を超えている' }, { id: 'undersize', description: '寸法・形状が規格または下限を下回っている' }, ...group.options] }
        : group),
  };
  const entry = persisted.classifications[0];
  const legacyEntry = {
    id: entry.id,
    classification: {
      ...Object.fromEntries(Object.entries(entry.classification).filter(([key]) => key !== 'dimension_direction')),
      phenomenon: [...entry.classification.phenomenon, 'oversize'],
    },
    judgments: {
      ...entry.judgments,
      'phenomenon:oversize': { type: 'noul', noul: 0.01 },
      'phenomenon:undersize': { type: 'noul', noul: 0.01 },
    },
  };
  await writeFile(storePath, JSON.stringify({ ...persisted, definition: legacyDefinition, classifications: [legacyEntry] }));
  let calls = 0;
  const migrated = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: async (input) => { calls += 1; return evaluator(input); } });
  const runtime = await migrated.prepare();
  assert.equal(runtime.reusedRecordCount, 0);
  assert.equal(runtime.classifiedRecordCount, 1);
  assert.equal(calls, 1);
});
