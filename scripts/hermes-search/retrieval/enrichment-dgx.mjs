// One chat completion per record through the existing consultation egress.
import { throughEgress } from '../hermes-remote-inference.mjs';
import { ENRICHMENT_JSON_SCHEMA, parseEnrichmentPayload } from './enrichment-contract.mjs';

const USAGE_KEYS = [
  ['prompt_tokens', 'promptTokens'],
  ['completion_tokens', 'completionTokens'],
];

export function enrichmentSettings(env = process.env) {
  const enabled = env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED === 'true';
  const maxRecords = positiveInt(env.HERMES_RETRIEVAL_ENRICHMENT_MAX_RECORDS, 100);
  const concurrency = env.HERMES_RETRIEVAL_ENRICHMENT_CONCURRENCY === '2' ? 2 : 1;
  const timeoutMs = clampInt(env.HERMES_RETRIEVAL_ENRICHMENT_TIMEOUT_MS, 50_000, 1_000, 55_000);
  return {
    enabled,
    maxRecords,
    concurrency,
    timeoutMs,
    window: env.HERMES_RETRIEVAL_ENRICHMENT_WINDOW || '',
    idAllowlist: env.HERMES_RETRIEVAL_ENRICHMENT_IDS || '',
    origin: env.HERMES_INFERENCE_ORIGIN || '',
    token: env.HERMES_INFERENCE_TOKEN || '',
    egress: env.HERMES_INFERENCE_EGRESS || '',
    model: env.HERMES_RETRIEVAL_ENRICHMENT_MODEL || env.BUSINESS_HERMES_CHAT_MODEL || 'system-prod-primary',
    profile: env.HERMES_RETRIEVAL_ENRICHMENT_PROFILE || 'business_qwen36_27b_nvfp4',
  };
}

export function withinWindow(windowSpec, date = new Date(), timeZone = 'Asia/Tokyo') {
  if (!windowSpec) return true;
  const match = /^(\d{1,2})-(\d{1,2})$/u.exec(windowSpec);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 23) return false;
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', hourCycle: 'h23',
  }).format(date));
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export async function requestEnrichment({
  settings,
  systemPrompt,
  recordText,
  fetchImpl,
  now = () => new Date(),
}) {
  const fetchFn = fetchImpl ?? (settings.egress ? throughEgress(settings.egress) : fetch);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: recordText },
  ];
  const guided = await postChat(fetchFn, settings, messages, true);
  if (guided.ok) return guided;
  // A truncated answer would be cut again without the schema, so only malformed answers retry.
  if (guided.unsupported || guided.errorClass === 'invalid_json' || guided.errorClass === 'schema_mismatch') {
    if (!withinWindow(settings.window, now())) {
      return { ok: false, stopped: true, errorClass: 'outside_window', latencyMs: guided.latencyMs ?? 0 };
    }
    return postChat(fetchFn, settings, messages, false);
  }
  return guided;
}

async function postChat(fetchFn, settings, messages, guided) {
  const started = Date.now();
  const body = {
    model: settings.model,
    messages,
    temperature: 0,
    max_tokens: 800,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (guided) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'hermes_record_enrichment',
        strict: true,
        schema: ENRICHMENT_JSON_SCHEMA,
      },
    };
  }
  let response;
  try {
    response = await fetchFn(`${settings.origin.replace(/\/$/u, '')}/v1/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(settings.timeoutMs),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.token}`,
        'x-llm-token': settings.token,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, errorClass: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'transport', latencyMs: Date.now() - started };
  }
  if (!response.ok) {
    await response.text().catch(() => '');
    return {
      ok: false,
      unsupported: guided && response.status === 400,
      errorClass: 'http',
      httpStatus: response.status,
      latencyMs: Date.now() - started,
    };
  }
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    return { ok: false, errorClass: 'invalid_json', latencyMs: Date.now() - started };
  }
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    return { ok: false, errorClass: 'truncated', latencyMs: Date.now() - started };
  }
  try {
    return {
      ok: true,
      parsed: parseEnrichmentPayload(choice?.message?.content),
      usage: usageOf(payload?.usage),
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return contentFailure(error, Date.now() - started);
  }
}

// Schema messages are fixed strings. JSON syntax messages can quote the answer, so they are not kept.
function contentFailure(error, latencyMs) {
  if (error instanceof TypeError) {
    return { ok: false, errorClass: 'schema_mismatch', detail: error.message, latencyMs };
  }
  return { ok: false, errorClass: 'invalid_json', latencyMs };
}

function usageOf(usage) {
  const result = { promptTokens: null, completionTokens: null };
  if (!usage || typeof usage !== 'object') return result;
  for (const [source, target] of USAGE_KEYS) {
    const value = usage[source];
    if (Number.isFinite(value)) result[target] = value;
  }
  return result;
}

function positiveInt(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (!/^[1-9]\d{0,5}$/u.test(String(raw))) return fallback;
  return Number(raw);
}

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
