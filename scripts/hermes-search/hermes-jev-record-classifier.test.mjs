import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuthorizedRecordClassifier, buildClassificationDefinition, extractStructuredConditions } from './hermes-jev-record-classifier.mjs';

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
        ? (request.includes('旋盤') ? 'turning' : request.includes('フライス') ? 'milling' : '__none_requested__')
        : (request.includes('旋盤') ? 'turning' : request.includes('フライス') ? 'milling' : 'unknown');
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

  const ambiguous = extractStructuredConditions('機械課の不適合', organizationSnapshot.records);
  assert.equal(ambiguous.unresolved[0].reason, 'ambiguous');
  const unknown = extractStructuredConditions('架空工場の不適合', organizationSnapshot.records);
  assert.equal(unknown.unresolved[0].reason, 'not_found');
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
