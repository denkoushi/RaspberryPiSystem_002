import { logger } from '../../lib/logger.js';

interface SlackMessage {
  clientId: string;
  clientName?: string;
  location?: string;
  page: string;
  message: string;
  requestId: string;
}

/**
 * Slack Incoming Webhookにメッセージを送信
 * Webhook URLは環境変数 `SLACK_KIOSK_SUPPORT_WEBHOOK_URL` から取得
 */
export async function sendSlackNotification(message: SlackMessage): Promise<void> {
  const webhookUrl = process.env.SLACK_KIOSK_SUPPORT_WEBHOOK_URL;
  
  if (!webhookUrl) {
    logger?.warn('[SlackWebhook] SLACK_KIOSK_SUPPORT_WEBHOOK_URL is not set, skipping notification');
    return;
  }

  // Webhook URLをログに出力しない（セキュリティ）
  const sanitizedUrl = webhookUrl.substring(0, 30) + '...';

  try {
    const payload = {
      text: '🔔 キオスクサポート通知',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*クライアントID*: ${message.clientId}\n*端末名*: ${message.clientName || '不明'}\n*場所*: ${message.location || '不明'}\n*画面*: ${message.page}\n*メッセージ*:\n${message.message}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Request ID: ${message.requestId}`
            }
          ]
        }
      ]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒タイムアウト

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger?.error(
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          requestId: message.requestId
        },
        '[SlackWebhook] Failed to send notification'
      );
      throw new Error(`Slack webhook returned ${response.status}: ${response.statusText}`);
    }

    logger?.info(
      { requestId: message.requestId, sanitizedUrl },
      '[SlackWebhook] Notification sent successfully'
    );
  } catch (error) {
    // タイムアウトまたはネットワークエラー
    if (error instanceof Error && error.name === 'AbortError') {
      logger?.error(
        { requestId: message.requestId, sanitizedUrl },
        '[SlackWebhook] Request timeout'
      );
    } else {
      logger?.error(
        {
          err: error,
          requestId: message.requestId,
          sanitizedUrl
        },
        '[SlackWebhook] Failed to send notification'
      );
    }
    // エラーを再スローしない（ユーザー体験優先）
    // 呼び出し側でログに記録するため、ここでは静かに失敗する
  }
}

