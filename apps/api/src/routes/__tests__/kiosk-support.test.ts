import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLocationScopeContext } from '../../lib/location-scope-resolver.js';
import { registerKioskSupportRoute } from '../kiosk/support.js';

const mocks = vi.hoisted(() => ({ log: vi.fn(), thread: vi.fn(), transaction: vi.fn(), slack: vi.fn(), device: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('../../services/tools/employee.service.js', () => ({ EmployeeService: class {} }));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({ findClientDeviceByApiKey: mocks.device }));
vi.mock('../../services/notifications/slack-webhook.js', () => ({ sendSlackNotification: mocks.slack }));

beforeEach(() => {
  mocks.log.mockReset().mockResolvedValue({});
  mocks.thread.mockReset().mockResolvedValue({ id: 'created-thread' });
  mocks.transaction.mockReset().mockImplementation(async callback => callback({
    clientLog: { create: mocks.log }, kioskInquiryThread: { create: mocks.thread }
  }));
  mocks.device.mockReset().mockResolvedValue({ id: 'device', name: '現場端末', location: '工場', siteKey: '工場' });
  mocks.slack.mockReset().mockResolvedValue(undefined);
});

async function sendSupport() {
  const app = Fastify();
  await registerKioskSupportRoute(app, {
    normalizeClientKey: raw => typeof raw === 'string' ? raw : undefined,
    checkRateLimit: async () => true,
    resolveLocationScopeContext
  });
  try {
    return await app.inject({
      method: 'POST', url: '/kiosk/support', headers: { 'x-client-key': 'key' },
      payload: { message: '送信者: 機械 一郎\n依頼内容: 現場まで来てください。', page: '/kiosk/borrow' }
    });
  } finally { await app.close(); }
}

describe('kiosk support response', () => {
  it('returns the created thread ID alongside requestId and preserves log, message and Slack fields', async () => {
    const response = await sendSupport();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requestId: expect.any(String), threadId: 'created-thread' });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.log).toHaveBeenCalledWith({ data: expect.objectContaining({
      clientId: 'device', message: '[SUPPORT] 送信者: 機械 一郎\n依頼内容: 現場まで来てください。'
    }) });
    expect(mocks.thread).toHaveBeenCalledWith({ data: expect.objectContaining({
      senderClientDeviceId: 'device', page: '/kiosk/borrow',
      messages: { create: { side: 'SENDER', body: '送信者: 機械 一郎\n依頼内容: 現場まで来てください。', authorClientDeviceId: 'device', createdAt: expect.any(Date) } }
    }) });
    expect(mocks.slack).toHaveBeenCalledWith({ clientId: 'device', clientName: '現場端末', location: '工場',
      page: '/kiosk/borrow', message: '送信者: 機械 一郎\n依頼内容: 現場まで来てください。', requestId: response.json().requestId });
  });

  it('does not return a thread ID or send Slack after transaction failure', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('transaction failed'));
    const response = await sendSupport();
    expect(response.statusCode).toBe(500);
    expect(response.json().threadId).toBeUndefined();
    expect(mocks.slack).not.toHaveBeenCalled();
  });

  it('keeps the response successful if Slack fails', async () => {
    mocks.slack.mockRejectedValueOnce(new Error('Slack unavailable'));
    const response = await sendSupport();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requestId: expect.any(String), threadId: 'created-thread' });
  });
});
