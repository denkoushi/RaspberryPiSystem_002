import type { AlertsRouteKey } from './alerts-config.js';

export type SlackDeliveryResult =
  | { ok: true }
  | { ok: false; error: string };

type AlertLike = {
  id?: string;
  type?: string;
  severity?: string;
  message?: string;
  details?: unknown;
  timestamp?: string;
  source?: unknown;
  context?: unknown;
};

function toSlackPayload(routeKey: AlertsRouteKey, alert: AlertLike) {
  const header = `🔔 Alert (${routeKey})`;
  const idLine = alert.id ? `*ID*: ${alert.id}\n` : '';
  const typeLine = alert.type ? `*Type*: ${alert.type}\n` : '';
  const severityLine = alert.severity ? `*Severity*: ${alert.severity}\n` : '';
  const tsLine = alert.timestamp ? `*Timestamp*: ${alert.timestamp}\n` : '';
  const msg = alert.message ?? '';
  const details =
    alert.details === undefined
      ? ''
      : typeof alert.details === 'string'
        ? alert.details
        : JSON.stringify(alert.details, null, 2);

  const body = `${idLine}${typeLine}${severityLine}${tsLine}*Message*:\n${msg}`;
  const detailsBlock = details
    ? [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Details*:\n\`\`\`\n${details}\n\`\`\``
          }
        }
      ]
    : [];

  return {
    text: header,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: header } },
      { type: 'section', text: { type: 'mrkdwn', text: body } },
      ...detailsBlock
    ]
  };
}

export async function sendSlackWebhook(options: {
  webhookUrl: string;
  routeKey: AlertsRouteKey;
  alert: AlertLike;
  timeoutMs: number;
}): Promise<SlackDeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const payload = toSlackPayload(options.routeKey, options.alert);
    const res = await fetch(options.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      return { ok: false, error: `Slack webhook returned ${res.status}: ${res.statusText}` };
    }

    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, error: err };
  } finally {
    clearTimeout(timer);
  }
}

