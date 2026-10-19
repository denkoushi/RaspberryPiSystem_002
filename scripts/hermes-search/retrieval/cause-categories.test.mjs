import test from 'node:test';
import assert from 'node:assert/strict';
import { CAUSE_CATEGORIES, CAUSE_CATEGORY_IDS, buildCauseQuestions, causeLabel, conditionSha256, normalizeConditionText, parseCauseAnswers } from './cause-categories.mjs';

test('cause questions use one choice per normalized bounded text and all fixed criteria', () => {
  const { state, questions, promptSha256 } = buildCauseQuestions([' Ａ\n B ', 'x'.repeat(450), 'fixture-3']);
  assert.deepEqual(state.records.map(row => row.no), [1, 2, 3]);
  assert.equal(state.records[0].condition === 'A B', true);
  assert.equal(state.records[1].condition.length, 400);
  assert.deepEqual(Object.keys(questions), ['r1', 'r2', 'r3']);
  for (let no = 1; no <= 3; no += 1) {
    const question = questions[`r${no}`];
    assert.equal(question.type, 'choice');
    assert.ok(question.instructions.includes(`no=${no}`));
    assert.deepEqual(Object.keys(question.criteria), CAUSE_CATEGORY_IDS);
    for (const category of CAUSE_CATEGORIES) {
      assert.equal(question.criteria[category.id], `${category.label}: ${category.description}`);
      assert.equal(causeLabel(category.id), category.label);
    }
  }
  assert.match(promptSha256, /^[a-f0-9]{64}$/u);
  assert.equal(promptSha256, buildCauseQuestions([]).promptSha256);
  assert.equal(promptSha256, buildCauseQuestions(['different']).promptSha256);
  assert.throws(() => buildCauseQuestions(Array(11).fill('fixture')), RangeError);
});

test('condition hashes normalize whitespace and NFKC without truncating the cache key', () => {
  assert.equal(normalizeConditionText(null), '');
  assert.equal(conditionSha256(' Ａ\n B '), conditionSha256('A B'));
  assert.notEqual(conditionSha256('x'.repeat(400) + 'a'), conditionSha256('x'.repeat(400) + 'b'));
});

test('cause answers accept fixed ids and reject unknown or missing choices', () => {
  assert.deepEqual(parseCauseAnswers({ r1: { choice: 'check', confidence: 0.9 }, r2: { choice: 'invalid' }, r3: { choice: 'unknown' } }, 4), [
    { categoryId: 'check' }, { categoryId: null }, { categoryId: 'unknown' }, { categoryId: null },
  ]);
});
