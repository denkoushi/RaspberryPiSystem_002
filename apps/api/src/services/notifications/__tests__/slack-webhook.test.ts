import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendSlackNotification } from '../slack-webhook.js';

// fetchをモック
global.fetch = vi.fn();

describe('sendSlackNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 環境変数をクリア
    delete process.env.SLACK_KIOSK_SUPPORT_WEBHOOK_URL;
  });

  it('should skip notification when webhook URL is not set', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    await sendSlackNotification({
      clientId: 'test-client',
      page: '/kiosk',
      message: 'Test message',
      requestId: 'test-request-id'
    });

    expect(global.fetch).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should send notification to Slack webhook', async () => {
    const webhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';
    process.env.SLACK_KIOSK_SUPPORT_WEBHOOK_URL = webhookUrl;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200
    });

    await sendSlackNotification({
      clientId: 'test-client-id',
      clientName: 'Test Client',
      location: 'Test Location',
      page: '/kiosk/borrow',
      message: 'Test support message',
      requestId: 'test-request-id'
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe(webhookUrl);
    expect(callArgs[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const payload = JSON.parse(callArgs[1].body);
    expect(payload.text).toBe('🔔 キオスクサポート通知');
    expect(payload.blocks[0].text.text).toContain('test-client-id');
    expect(payload.blocks[0].text.text).toContain('Test Client');
    expect(payload.blocks[0].text.text).toContain('Test Location');
    expect(payload.blocks[0].text.text).toContain('/kiosk/borrow');
    expect(payload.blocks[0].text.text).toContain('Test support message');
    expect(payload.blocks[1].elements[0].text).toContain('test-request-id');
  });

  it('should handle timeout gracefully', async () => {
    const webhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';
    process.env.SLACK_KIOSK_SUPPORT_WEBHOOK_URL = webhookUrl;

    // AbortErrorをシミュレート
    const abortError = new Error('Request timeout');
    abortError.name = 'AbortError';
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(abortError);

    // エラーが再スローされないことを確認（ユーザー体験優先）
    await expect(
      sendSlackNotification({
        clientId: 'test-client',
        page: '/kiosk',
        message: 'Test message',
        requestId: 'test-request-id'
      })
    ).resolves.not.toThrow();
  });

  it('should handle HTTP error responses gracefully', async () => {
    const webhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';
    process.env.SLACK_KIOSK_SUPPORT_WEBHOOK_URL = webhookUrl;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Error message'
    });

    // エラーが再スローされないことを確認（ユーザー体験優先）
    await expect(
      sendSlackNotification({
        clientId: 'test-client',
        page: '/kiosk',
        message: 'Test message',
        requestId: 'test-request-id'
      })
    ).resolves.not.toThrow();
  });

  it('should not log webhook URL in error messages', async () => {
    const webhookUrl = 'https://hooks.slack.com/services/SECRET/WEBHOOK/URL';
    process.env.SLACK_KIOSK_SUPPORT_WEBHOOK_URL = webhookUrl;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await sendSlackNotification({
      clientId: 'test-client',
      page: '/kiosk',
      message: 'Test message',
      requestId: 'test-request-id'
    });

    // エラーログに完全なWebhook URLが含まれていないことを確認
    const errorCalls = consoleErrorSpy.mock.calls;
    const hasFullUrl = errorCalls.some((call) => {
      const args = JSON.stringify(call);
      return args.includes(webhookUrl);
    });
    expect(hasFullUrl).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});

