import type { TextChatMessage } from '../../inference/ports/text-completion.port.js';
import { extractJsonObject, stringList } from '../../../lib/llm-json.js';

export type Organized = { topics: string[]; decisions: string[]; open: string[]; actions: string[]; next: string };
export const EMPTY_ORGANIZED: Organized = { topics: [], decisions: [], open: [], actions: [], next: '' };
export const TRANSCRIPT_MAX_CHARS = 12000;

export type CompleteFn = (messages: TextChatMessage[], signal: AbortSignal) => Promise<string>;

const strings = (value: unknown) => stringList(value, 30);

/** Parses the LLM answer defensively; returns null when it is not usable JSON. */
export function parseOrganized(raw: string): Organized | null {
  const data = extractJsonObject(raw);
  if (!data) return null;
  return {
    topics: strings(data.topics),
    decisions: strings(data.decisions),
    open: strings(data.open),
    actions: strings(data.actions),
    next: typeof data.next === 'string' ? data.next.trim() : ''
  };
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

/** 現場で聞き違えやすい語。文書の語と合わせて、整理のときの書き直しの手がかりにする。 */
const SHOP_TERMS = '研削 切削 砥石 要領書 段取り 治具 主軸 ドレッシング';

export function buildOrganizeMessages(transcript: string, previous: Organized | null, terms = ''): TextChatMessage[] {
  const tail = transcript.length > TRANSCRIPT_MAX_CHARS ? transcript.slice(-TRANSCRIPT_MAX_CHARS) : transcript;
  const system = [
    'あなたは製造現場の話し合いの書記です。発言記録を読み、次のJSONだけを日本語で返してください。説明やコードブロックは付けません。',
    '{"topics":[],"decisions":[],"open":[],"actions":[],"next":""}',
    'topics=論点、decisions=決まったこと、open=未決、actions=宿題(担当がわかれば「担当: 内容」の形で添える)、next=次に話すとよいこと(1文)。',
    '各項目は短い1文の配列。記録にないことは書かない。聞き取りの誤りで明らかに不自然な語は文脈から直してよい。',
    `この場で使う語(音の似た聞き違いはこの語に直す。例: 検索→研削、研い師→砥石、容量書→要領書): ${[SHOP_TERMS, terms.slice(0, 300)].filter(Boolean).join(' ')}`
  ].join('\n');
  const prev = previous ? `\n\n前回の整理:\n${JSON.stringify(previous)}` : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `発言記録:\n${tail}${prev}` }
  ];
}

/** Returns the new organised result, or null when the call or parse fails. */
export async function organizeTranscript(
  complete: CompleteFn, transcript: string, previous: Organized | null, timeoutMs = 60000, terms = '', externalSignal?: AbortSignal
): Promise<Organized | null> {
  // 失敗・読めない答えは null
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
  try {
    const raw = await complete(buildOrganizeMessages(transcript, previous, terms), signal);
    return parseOrganized(raw);
  } catch {
    return null; // 失敗は null で返し、呼び出し側が整理し直す
  }
}
