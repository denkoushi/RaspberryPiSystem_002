import type { TextChatMessage } from '../../inference/ports/text-completion.port.js';

export type Organized = { topics: string[]; decisions: string[]; open: string[]; actions: string[]; next: string };
export const EMPTY_ORGANIZED: Organized = { topics: [], decisions: [], open: [], actions: [], next: '' };
export const TRANSCRIPT_MAX_CHARS = 12000;

export type CompleteFn = (messages: TextChatMessage[], signal: AbortSignal) => Promise<string>;

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, 30);
}

/** Parses the LLM answer defensively; returns null when it is not usable JSON. */
export function parseOrganized(raw: string): Organized | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  text = text.slice(start, end + 1);
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;
    return {
      topics: strings(data.topics),
      decisions: strings(data.decisions),
      open: strings(data.open),
      actions: strings(data.actions),
      next: typeof data.next === 'string' ? data.next.trim() : ''
    };
  } catch {
    return null;
  }
}

export function renderOrganized(o: Organized): string {
  const sections: Array<[string, string[]]> = [
    ['論点', o.topics], ['決まったこと', o.decisions], ['未決', o.open], ['宿題', o.actions]
  ];
  return sections
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => `【${title}】\n${items.map((i) => `・${i}`).join('\n')}`)
    .join('\n');
}

export function buildOrganizeMessages(transcript: string, previous: Organized | null): TextChatMessage[] {
  const tail = transcript.length > TRANSCRIPT_MAX_CHARS ? transcript.slice(-TRANSCRIPT_MAX_CHARS) : transcript;
  const system = [
    'あなたは製造現場の話し合いの書記です。発言記録を読み、次のJSONだけを日本語で返してください。説明やコードブロックは付けません。',
    '{"topics":[],"decisions":[],"open":[],"actions":[],"next":""}',
    'topics=論点、decisions=決まったこと、open=未決、actions=宿題(担当がわかれば「担当: 内容」の形で添える)、next=次に話すとよいこと(1文)。',
    '各項目は短い1文の配列。記録にないことは書かない。聞き取りの誤りで明らかに不自然な語は文脈から直してよい。'
  ].join('\n');
  const prev = previous ? `\n\n前回の整理:\n${JSON.stringify(previous)}` : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `発言記録:\n${tail}${prev}` }
  ];
}

/** Returns the new organised result, or `previous` when the call or parse fails. */
export async function organizeTranscript(
  complete: CompleteFn, transcript: string, previous: Organized | null, timeoutMs = 60000
): Promise<Organized | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await complete(buildOrganizeMessages(transcript, previous), controller.signal);
    return parseOrganized(raw) ?? previous;
  } catch {
    return previous;
  } finally {
    clearTimeout(timer);
  }
}
