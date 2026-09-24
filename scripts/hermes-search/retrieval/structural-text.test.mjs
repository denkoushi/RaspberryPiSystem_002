import test from 'node:test';
import assert from 'node:assert/strict';
import { contentQuery, isParticleFragment } from './structural-text.mjs';

function assertNoParticleFragments(text) {
  for (const fragment of text.split(/\s+/u).filter(Boolean)) {
    assert.equal(isParticleFragment(fragment), false, fragment);
  }
}

test('contentQuery drops leftover particle fragments after structural removal', () => {
  const junk = contentQuery('qxrareの を のものから');
  assert.equal(junk, 'qxrare');
  assertNoParticleFragments(junk);

  const phrase = contentQuery('qxrareの最近のものから');
  assert.equal(phrase, 'qxrare');
  assertNoParticleFragments(phrase);

  for (const question of [
    '新しいものからqxrareを見せて',
    '新しい順にqxrareを3件',
    '古い順にqxrare',
    '直近のものからqxrareの記録',
  ]) {
    const stripped = contentQuery(question);
    assert.equal(stripped, 'qxrare');
    assertNoParticleFragments(stripped);
  }
});

test('contentQuery keeps a content token that merely contains a particle', () => {
  assert.equal(contentQuery('abcやdef'), 'abcやdef');
  assert.equal(contentQuery('surface scratch'), 'surface scratch');
});
