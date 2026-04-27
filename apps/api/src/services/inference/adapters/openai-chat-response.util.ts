type UpstreamChoiceMessage = {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
};

export type OpenAiStyleChatResponse = {
  model?: unknown;
  choices?: Array<{
    message?: UpstreamChoiceMessage;
  }>;
};

const extractTextLikeField = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const texts = value
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        if ('text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean);
    const joined = texts.join(' ').trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
};

/**
 * OpenAI 互換 assistant message から本文を取り出す。
 * vLLM / Qwen 系で `content` が空でも `reasoning` / `reasoning_content` に出る場合に追従する。
 */
export function extractAssistantTextFromOpenAiStyleMessageContent(content: unknown): string | null {
  return extractTextLikeField(content);
}

function resolveAssistantTextFromChoiceMessage(message: UpstreamChoiceMessage | undefined): string | null {
  if (!message) {
    return null;
  }
  return (
    extractTextLikeField(message.content) ??
    extractTextLikeField(message.reasoning) ??
    extractTextLikeField(message.reasoning_content)
  );
}

export function extractTextFromOpenAiStylePayload(payload: OpenAiStyleChatResponse): string | null {
  const first = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  return resolveAssistantTextFromChoiceMessage(first?.message);
}
