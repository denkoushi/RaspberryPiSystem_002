import assert from 'node:assert/strict';
import test from 'node:test';
import { decideLink, querySpans, valueForms } from './entity-link.mjs';
import { rankByCosine } from './dense-index.mjs';

test('value forms strip hierarchy markers and keep the section', () => {
  const forms = valueForms('Alpha工場Beta部（製造）Gamma課');
  assert.equal(forms.includes('Alpha'), true);
  assert.equal(forms.includes('Gamma課'), true);
  assert.equal(forms.includes('AlphaBetaGamma課'), true);
});

test('a unique factory form selects one value and a shared section stays multi-value', () => {
  const unique = decideLink([
    { value: 'Alpha工場製造部機械課', form: 'Alpha', score: 0.96 },
    { value: 'Alpha工場製造部機械課', form: '機械課', score: 0.99 },
    { value: 'Beta工場製造部機械課', form: '機械課', score: 0.99 },
  ]);
  assert.deepEqual(unique, { decision: 'eq', values: ['Alpha工場製造部機械課'] });
  const shared = decideLink([
    { value: 'Alpha工場製造部機械課', form: '機械課', score: 0.97 },
    { value: 'Beta工場製造部機械課', form: '機械課', score: 0.96 },
  ]);
  assert.equal(shared.decision, 'in');
  assert.equal(shared.values.length, 2);
});

test('more than eight close values ask for clarification', () => {
  const hits = Array.from({ length: 9 }, (_, index) => ({
    value: `課${index}`,
    form: '課名',
    score: 0.9,
  }));
  const decided = decideLink(hits);
  assert.equal(decided.decision, 'clarify');
  assert.equal(decided.values.length, 9);
});

test('query spans keep the whole question and content tokens', () => {
  const spans = querySpans('Alphaの記録を見せて');
  assert.equal(spans.some((span) => span.includes('alpha')), true);
});

test('dense rank orders by cosine', () => {
  const ranked = rankByCosine([1, 0], [
    { id: 'far', vector: [0, 1] },
    { id: 'near', vector: [1, 0] },
  ]);
  assert.equal(ranked[0].id, 'near');
});
