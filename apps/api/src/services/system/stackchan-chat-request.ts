import type { LocalLlmChatMessage } from './local-llm-proxy.service.js';

/**
 * StackChan 既定の「詳説優先」方針を system メッセージで付与する。
 * クライアントが先頭に system を付けた場合は、その内容に追記して二重 system を避ける。
 */
export const STACKCHAN_DETAIL_SYSTEM_PROMPT_JA = [
  'あなたは製造現場のスタッフ向けアシスタントです。',
  '回答は「結論」を最初に述べ、その後に理由・前提・手順や注意点を十分に説明してください。',
  '簡潔すぎる省略は避け、冗長な繰り返しだけは避けてください。',
].join('');

export function mergeStackChanDetailSystemPrompt(messages: LocalLlmChatMessage[]): LocalLlmChatMessage[] {
  if (messages.length === 0) {
    return messages;
  }
  const [first, ...rest] = messages;
  if (first.role === 'system') {
    if (first.content.includes(STACKCHAN_DETAIL_SYSTEM_PROMPT_JA)) {
      return messages;
    }
    return [{ role: 'system', content: `${first.content}\n\n${STACKCHAN_DETAIL_SYSTEM_PROMPT_JA}` }, ...rest];
  }
  return [{ role: 'system', content: STACKCHAN_DETAIL_SYSTEM_PROMPT_JA }, ...messages];
}
