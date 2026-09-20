import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuthorizedRecordClassifier } from './hermes-jev-record-classifier.mjs';

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
  assert.equal(persisted.classifications[0].judgments['phenomenon:oversize'].type, 'noul');
  assert.equal(persisted.classifications[0].judgments['phenomenon:oversize'].noul, 0.96);
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
      delete result.answers['phenomenon:oversize'];
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
