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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slack-webhook.ts:16',message:'sendSlackNotification called',data:{clientId:message.clientId,clientName:message.clientName,requestId:message.requestId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  const webhookUrl = process.env.SLACK_KIOSK_SUPPORT_WEBHOOK_URL;
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slack-webhook.ts:19',message:'webhookUrl check',data:{hasWebhookUrl:!!webhookUrl,webhookUrlLength:webhookUrl?.length||0,isEmpty:webhookUrl===''},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (!webhookUrl) {
    logger?.warn('[SlackWebhook] SLACK_KIOSK_SUPPORT_WEBHOOK_URL is not set, skipping notification');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slack-webhook.ts:22',message:'webhookUrl not set, returning early',data:{requestId:message.requestId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slack-webhook.ts:53',message:'fetch request starting',data:{requestId:message.requestId,sanitizedUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slack-webhook.ts:64',message:'fetch response received',data:{requestId:message.requestId,status:response.status,statusText:response.statusText,ok:response.ok},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slack-webhook.ts:85',message:'fetch timeout error',data:{requestId:message.requestId,errorName:error.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      logger?.error(
        { requestId: message.requestId, sanitizedUrl },
        '[SlackWebhook] Request timeout'
      );
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slack-webhook.ts:90',message:'fetch error',data:{requestId:message.requestId,errorName:error instanceof Error?error.name:'unknown',errorMessage:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
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

