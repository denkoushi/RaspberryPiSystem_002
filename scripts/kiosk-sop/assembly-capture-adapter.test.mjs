import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAssemblyCaptureAdapter } from './assembly-capture-adapter.mjs';

test('assembly fixtures acquire, heartbeat and release the editor lease', async () => {
  let handleRoute;
  const unexpectedRequests = new Set();
  await resolveAssemblyCaptureAdapter('assembly-document-editor-v1').installApiFixtures({
    async route(_matches, handler) { handleRoute = handler; }
  }, 'assembly-document-editor-text-properties', unexpectedRequests);

  for (const documentId of ['sop-procedure-1', 'sop-procedure-revision-1']) {
    for (const method of ['POST', 'POST', 'DELETE']) {
      let response;
      await handleRoute({
        request: () => ({
          url: () => `http://localhost/api/assembly/procedure-documents/${documentId}/edit-lease`,
          method: () => method
        }),
        async fulfill(value) { response = value; }
      });
      assert.equal(response.status, method === 'DELETE' ? 204 : 200);
      if (method === 'POST') {
        const body = JSON.parse(response.body);
        assert.equal(body.mine, true);
        assert.equal(body.holderToken, 'sop-fixture');
        assert.equal(body.lease.holderLabel, '取説生成端末');
        assert.equal(Date.parse(body.lease.expiresAt) - Date.parse(body.lease.heartbeatAt), 300_000);
      } else {
        assert.equal(response.body, undefined);
      }
    }
  }
  assert.equal(unexpectedRequests.size, 0);
});
