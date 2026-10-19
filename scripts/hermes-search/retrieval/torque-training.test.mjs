import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { authorizedRecords } from './corpus.mjs';
import { buildValueIndex } from './value-index.mjs';
import { createPlanner } from './planner-jev.mjs';
import { createRetrievalAnswering } from './worker.mjs';

const sourceIds = ['nonconformity', 'knowledge_procedure', 'torque_training_session', 'torque_training_operator', 'torque_training_team'];
const catalog = loadCatalog(sourceIds);
const records = authorizedRecords([
  { kind: 'nonconformity', id: 'n1', nonconformityNo: 'SYNTH-N', discoveredOn: '2026-10-01', condition: '合成不適合原文' },
  { kind: 'knowledge_procedure', id: 'p1', title: '合成手順', stepsText: '合成手順原文' },
  { kind: 'torque_training_session', id: 'a-oct', sessionId: 'a-oct', employeeName: '合成作業者A', employeeCode: 'SYNTH-A', completedOn: '2026-10-04', summaryText: '5回中4回合格。不合格あり。3回目が上限超え。', attemptsText: '3回目: 10.6 N·m、目標 10 N·m、上限超え。' },
  { kind: 'torque_training_session', id: 'a-sep', sessionId: 'a-sep', employeeName: '合成作業者A', employeeCode: 'SYNTH-A', completedOn: '2026-09-30', summaryText: '全回合格。' },
  { kind: 'torque_training_session', id: 'b-oct', sessionId: 'b-oct', employeeName: '合成作業者B', employeeCode: 'SYNTH-B', completedOn: '2026-10-31', summaryText: '全回合格。' },
  { kind: 'torque_training_operator', id: 'operator-a', employeeName: '合成作業者A', employeeCode: 'SYNTH-A', lastTrainingOn: '2026-10-04', summaryText: '全期間: 合格率80.0%。強めに締める傾向。', comparisonText: '直近と全期間の比較: 上達傾向。' },
  { kind: 'torque_training_team', id: 'team', teamName: '訓練チーム全体', summaryText: 'チーム全体の全期間: 合格率90.0%。', recentText: 'チーム全体の直近10セッション: 合格率95.0%。' },
], catalog);

// Synthetic JEV choices exercise the real planner without any external request.
function evaluateFor(source, employeeName = null) {
  return async ({ questions }) => {
    const answers = {
      scope: { type: 'choice', choice: source },
      content: { type: 'noul', noul: false },
      sort: { type: 'choice', choice: 'recent' },
      limit: { type: 'choice', choice: '10' },
    };
    for (const [key, question] of Object.entries(questions)) {
      if (!key.startsWith('field_')) continue;
      const requestedValue = employeeName ?? (source === 'torque_training_team' ? '訓練チーム全体' : null);
      const match = requestedValue && Object.entries(question.criteria).find(([, value]) => value === requestedValue);
      answers[key] = { type: 'choice', choice: match ? match[0] : 'none' };
    }
    return { answers };
  };
}

test('training session planner and kiosk worker filter employee name and completion month from a mixed corpus', async () => {
  const evaluate = evaluateFor('torque_training_session', '合成作業者A');
  const planner = createPlanner({ evaluate });
  const question = '合成作業者Aの2026年10月の訓練結果を見せて';
  const { plan } = await planner.plan({ question, catalog, valueIndex: buildValueIndex(records, catalog) });
  assert.deepEqual(plan.sources, ['torque_training_session']);
  assert.ok(plan.filters.every(filter => plan.sources.includes(filter.source)));
  assert.ok(plan.filters.some(filter => filter.source === 'torque_training_session' && filter.field === 'employeeName' && filter.values[0] === '合成作業者A'));
  assert.ok(plan.filters.some(filter => filter.source === 'torque_training_session' && filter.field === 'completedOn' && filter.op === 'between'
    && filter.values.join(',') === '2026-10-01,2026-10-31'));
  const answering = createRetrievalAnswering({ records, catalog, planner, evaluate });
  const answer = await answering.answer(question, null, { principal: { kind: 'kiosk' } });
  assert.deepEqual(answer.recordIds, ['torque_training_session:a-oct']);
  assert.match(answer.answer, /5回中4回合格。不合格あり。3回目が上限超え。/u);
  assert.match(answer.answer, /3回目: 10.6 N·m、目標 10 N·m、上限超え。/u);
  assert.doesNotMatch(answer.answer, /合成作業者B|合成不適合原文|合成手順原文/u);
});

test('completion period includes month boundaries and all three training sources are visible to kiosk', async () => {
  const evaluate = evaluateFor('torque_training_session');
  const answering = createRetrievalAnswering({ records, catalog, evaluate });
  const result = await answering.answer('2026年10月の訓練結果', null, { principal: { kind: 'kiosk' } });
  assert.deepEqual(new Set(result.recordIds), new Set(['torque_training_session:a-oct', 'torque_training_session:b-oct']));
  for (const [source, question, expectedId, expectedText] of [
    ['torque_training_operator', '合成作業者Aの訓練の合格率', 'operator-a', /強めに締める傾向/u],
    ['torque_training_team', '訓練チーム全体の合格率', 'team', /チーム全体の全期間/u],
  ]) {
    const select = evaluateFor(source, source === 'torque_training_operator' ? '合成作業者A' : null);
    const selectedPlan = await createPlanner({ evaluate: select }).plan({ question, catalog, valueIndex: buildValueIndex(records, catalog) });
    assert.ok(selectedPlan.plan.filters.every(filter => filter.source === source));
    assert.deepEqual(selectedPlan.plan.sort, { field: source === 'torque_training_team' ? 'teamName' : 'lastTrainingOn', direction: 'desc' });
    const worker = createRetrievalAnswering({ records, catalog, evaluate: select });
    const answer = await worker.answer(question, null, { principal: { kind: 'kiosk' } });
    assert.deepEqual(answer.recordIds, [`${source}:${expectedId}`]);
    assert.match(answer.answer, expectedText);
  }
});
