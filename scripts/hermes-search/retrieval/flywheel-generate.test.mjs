import test from 'node:test';
import assert from 'node:assert/strict';
import { createDgxChat, guardChat, probeChat } from './flywheel-generate.mjs';

test('the readiness probe sends one tiny fixed request with the requested timeout', async () => {
  const requests = [];
  const chat = async (request) => {
    requests.push(request);
    return { ok: true, content: 'OK' };
  };
  assert.deepEqual(await probeChat(chat, { timeoutMs: 123 }), { ok: true });
  assert.deepEqual(requests, [{ messages: [{ role: 'user', content: 'Reply OK.' }], maxTokens: 8, timeoutMs: 123 }]);
});

test('probe limits override the adapter defaults for that request only', async () => {
  const requests = [];
  const chat = createDgxChat({ origin: 'http://dgx', token: 'test-token', maxTokens: 200,
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) };
    },
  });
  assert.deepEqual(await probeChat(chat), { ok: true });
  await chat({ messages: [] });
  assert.equal(requests[0].max_tokens, 8);
  assert.equal(requests[0].temperature, 0);
  assert.equal(requests[0].chat_template_kwargs.enable_thinking, false);
  assert.equal(Object.hasOwn(requests[0], 'response_format'), false);
  assert.equal(requests[1].max_tokens, 200);
});

test('probe failures retain the DGX adapter reason vocabulary', async () => {
  for (const reason of ['http_503', 'http_429', 'timeout', 'transport', 'truncated']) {
    assert.deepEqual(await probeChat(async () => ({ ok: false, reason })), { ok: false, reason });
  }
  for (const [name, reason] of [['TimeoutError', 'timeout'], ['AbortError', 'timeout'], ['TypeError', 'transport']]) {
    assert.deepEqual(await probeChat(async () => { throw Object.assign(new Error('failed'), { name }); }), { ok: false, reason });
  }
});

test('the adapter honors the probe timeout and reports HTTP and transport failures', async () => {
  const chat = (fetchImpl) => createDgxChat({ origin: 'http://dgx', token: 'test-token', fetchImpl });
  assert.deepEqual(await probeChat(chat(async () => ({ ok: false, status: 503, text: async () => '' }))), { ok: false, reason: 'http_503' });
  assert.deepEqual(await probeChat(chat(async () => { throw new TypeError('offline'); })), { ok: false, reason: 'transport' });
  let aborted = false;
  const timeoutChat = chat(async (_url, { signal }) => {
    // Keep the fake request alive: AbortSignal.timeout alone uses an unref'ed timer.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1_000);
      signal.addEventListener('abort', () => {
        aborted = true;
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
    assert.fail('the probe must abort before the adapter default timeout');
  });
  assert.deepEqual(await probeChat(timeoutChat, { timeoutMs: 10 }), { ok: false, reason: 'timeout' });
  assert.equal(aborted, true);
});

test('a failed raw readiness probe does not consume guard strikes', async () => {
  let calls = 0;
  const chat = async () => { calls += 1; return { ok: false, reason: 'http_503' }; };
  const guarded = guardChat(chat, { maxStrikes: 1 });
  assert.deepEqual(await probeChat(chat), { ok: false, reason: 'http_503' });
  assert.equal(guarded.tripped(), false);
  assert.deepEqual(await guarded({}), { ok: false, reason: 'http_503' });
  assert.equal(guarded.tripped(), true);
  assert.equal(calls, 2);
});
