import type { FastifyBaseLogger } from 'fastify';

export type LocalLlmHealthCheckResultKind =
  | 'ok'
  | 'not_configured'
  | 'upstream_non_ok'
  | 'fetch_error';

export type LocalLlmHealthCheckOutcome = {
  durationMs: number;
  configured: boolean;
  ok: boolean;
  statusCode?: number;
  result: LocalLlmHealthCheckResultKind;
};

export type LocalLlmChatCompletionOutcome = {
  durationMs: number;
  ok: boolean;
  errorCode?: string;
  messageCount: number;
  maxTokens: number;
  temperature: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type LocalLlmObservability = {
  emitHealthCheckOutcome: (evt: LocalLlmHealthCheckOutcome) => void;
  emitChatCompletionOutcome: (evt: LocalLlmChatCompletionOutcome) => void;
};

export function createNoOpLocalLlmObservability(): LocalLlmObservability {
  return {
    emitHealthCheckOutcome: () => undefined,
    emitChatCompletionOutcome: () => undefined,
  };
}

export function createPinoLocalLlmObservability(log: FastifyBaseLogger): LocalLlmObservability {
  return {
    emitHealthCheckOutcome(evt: LocalLlmHealthCheckOutcome): void {
      const payload = {
        event: 'local_llm.health_check',
        durationMs: evt.durationMs,
        configured: evt.configured,
        ok: evt.ok,
        statusCode: evt.statusCode,
        result: evt.result,
      };
      if (evt.result === 'ok') {
        log.info(payload, 'LocalLLM health check ok');
        return;
      }
      if (evt.result === 'not_configured') {
        log.info(payload, 'LocalLLM health check skipped (not configured)');
        return;
      }
      log.warn(payload, 'LocalLLM health check degraded');
    },

    emitChatCompletionOutcome(evt: LocalLlmChatCompletionOutcome): void {
      const payload = {
        event: 'local_llm.chat_completion',
        durationMs: evt.durationMs,
        ok: evt.ok,
        errorCode: evt.errorCode,
        messageCount: evt.messageCount,
        maxTokens: evt.maxTokens,
        temperature: evt.temperature,
        usage: evt.usage,
      };
      if (evt.ok) {
        log.info(payload, 'LocalLLM chat completion ok');
        return;
      }
      log.warn(payload, 'LocalLLM chat completion failed');
    },
  };
}
