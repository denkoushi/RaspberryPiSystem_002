import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoneQueryEmbedding, withEmbeddingBudget } from './query-embedding.mjs';

test('the none query embedding does not call a model', async () => {
  const embedding = createNoneQueryEmbedding();
  assert.equal(embedding.id, 'none');
  const result = await embedding.embedQuery('qxprobe');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'not_requested');
});

test('query embedding budget rejects a slow provider', async () => {
  await assert.rejects(
    () => withEmbeddingBudget(() => new Promise(() => {}), 20),
    (error) => error?.code === 'timeout',
  );
});
