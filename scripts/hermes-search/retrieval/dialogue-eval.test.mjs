import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTurn, evaluateDialogues, scoreTurn } from './dialogue-eval.mjs';

const plan = (overrides = {}) => ({
  sources: ['nonconformity'],
  filters: [{ source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: ['South Shop'] }],
  semanticQuery: '',
  sort: { field: 'discoveredOn', direction: 'desc' },
  limit: 2,
  ...overrides,
});

test('a turn is checked slot by slot and reports each failed slot', () => {
  assert.deepEqual(checkTurn(plan(), {
    filters: { originDepartmentName: ['South Shop'] }, content: false, sort: 'recent', limit: 2,
  }), []);
  assert.deepEqual(checkTurn(plan(), {
    mustHave: { partName: ['Table'] }, content: true, sort: 'relevance', limit: 5,
  }).sort(), ['content', 'limit', 'mustHave:partName', 'sort']);
  assert.deepEqual(checkTurn(plan(), { mustNotHave: ['originDepartmentName'] }), ['mustNotHave:originDepartmentName']);
});

test('anyOf accepts either reading of an ambiguous follow-up', () => {
  const turn = { anyOf: [{ mustNotHave: ['originDepartmentName'], content: true }, { mustHave: { originDepartmentName: ['South Shop'] }, content: true }] };
  assert.equal(scoreTurn(plan({ semanticQuery: 'paint' }), turn).passed, true);
  assert.equal(scoreTurn(plan(), turn).passed, false);
});

test('each turn is planned with the previous compact plan and setup turns are not scored', async () => {
  const seen = [];
  const report = await evaluateDialogues({
    dialogues: [{
      id: 'd1',
      turns: [
        { question: 'first', setup: true },
        { question: 'second', expect: { content: true } },
      ],
    }],
    plan: async (question, previousPlan) => {
      seen.push({ question, previousLimit: previousPlan?.limit ?? null });
      return question === 'first' ? plan() : plan({ semanticQuery: 'second' });
    },
  });
  assert.deepEqual(seen, [{ question: 'first', previousLimit: null }, { question: 'second', previousLimit: 2 }]);
  assert.deepEqual(report.summary, { dialogues: 1, dialoguesPassed: 1, turns: 1, turnsPassed: 1, failuresBySlot: {} });
  assert.equal(JSON.stringify(report).includes('first'), false);
});
