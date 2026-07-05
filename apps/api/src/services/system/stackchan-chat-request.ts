import type { LocalLlmChatMessage } from './local-llm-proxy.service.js';
import {
  INFERENCE_PROMPT_DEFAULTS,
  resolveStackChanSystemPrompt,
} from '../inference/prompts/inference-prompt-registry.js';

/**
 * StackChan 既定の「詳説優先」方針を system メッセージで付与する。
 * クライアントが先頭に system を付けた場合は、その内容に追記して二重 system を避ける。
 */
export const STACKCHAN_DETAIL_SYSTEM_PROMPT_JA = INFERENCE_PROMPT_DEFAULTS.stackchanSystemPrompt;

export function mergeStackChanDetailSystemPrompt(messages: LocalLlmChatMessage[]): LocalLlmChatMessage[] {
  if (messages.length === 0) {
    return messages;
  }
  const detailPrompt = resolveStackChanSystemPrompt();
  const [first, ...rest] = messages;
  if (first.role === 'system') {
    if (first.content.includes(detailPrompt)) {
      return messages;
    }
    return [{ role: 'system', content: `${first.content}\n\n${detailPrompt}` }, ...rest];
  }
  return [{ role: 'system', content: detailPrompt }, ...messages];
}
