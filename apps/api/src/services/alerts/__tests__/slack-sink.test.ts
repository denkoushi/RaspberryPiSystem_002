import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendSlackWebhook } from '../slack-sink.js';

describe('slack-sink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends payload with string details block', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSlackWebhook({
      webhookUrl: 'https://hooks.slack.com/services/test',
      routeKey: 'ops',
      timeoutMs: 1000,
      alert: {
        id: 'a-1',
        type: 'storage-alert',
        severity: 'warning',
        message: 'message',
        details: 'disk 95%',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(result).toEqual({ ok: true });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(options.body as string);
    expect(payload.text).toContain('Alert (ops)');
    expect(payload.blocks[2].text.text).toContain('disk 95%');
  });

  it('sends payload with object details serialized as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlackWebhook({
      webhookUrl: 'https://hooks.slack.com/services/test',
      routeKey: 'deploy',
      timeoutMs: 1000,
      alert: {
        message: 'deploy failed',
        details: { host: 'pi5', code: 'E100' },
      },
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(options.body as string);
    expect(payload.blocks[2].text.text).toContain('"host": "pi5"');
    expect(payload.blocks[2].text.text).toContain('"code": "E100"');
  });

  it('returns error when slack webhook responds with non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSlackWebhook({
      webhookUrl: 'https://hooks.slack.com/services/test',
      routeKey: 'support',
      timeoutMs: 1000,
      alert: { message: 'failed' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Slack webhook returned 500');
    }
  });

  it('returns error when fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSlackWebhook({
      webhookUrl: 'https://hooks.slack.com/services/test',
      routeKey: 'security',
      timeoutMs: 1000,
      alert: { message: 'failed' },
    });

    expect(result).toEqual({ ok: false, error: 'Error: network down' });
  });
});
