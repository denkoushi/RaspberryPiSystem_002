type UpstreamChoiceMessage = {
  content?: unknown;
};

export type OpenAiStyleChatResponse = {
  model?: unknown;
  choices?: Array<{
    message?: UpstreamChoiceMessage;
  }>;
};

export function extractAssistantTextFromOpenAiStyleMessage(content: unknown): string | null {
  if (typeof content === 'string') {
    const t = content.trim();
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean);
    const joined = texts.join(' ').trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

export function extractTextFromOpenAiStylePayload(payload: OpenAiStyleChatResponse): string | null {
  const first = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  return extractAssistantTextFromOpenAiStyleMessage(first?.message?.content);
}
