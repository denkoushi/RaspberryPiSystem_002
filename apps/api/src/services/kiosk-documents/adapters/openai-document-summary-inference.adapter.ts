import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';

import type { TextCompletionPort } from '../../inference/ports/text-completion.port.js';
import type { DocumentSummaryInferencePort } from '../ports/document-summary-inference.port.js';
import {
  buildKioskDocumentSummaryUserMessage,
  KIOSK_DOCUMENT_SUMMARY_SYSTEM_PROMPT,
} from '../kiosk-document-summary-prompt.js';

const log = logger.child({ component: 'kioskDocumentSummaryInference' });

function collapseAndClip(s: string, maxChars: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * document_summary 用途の TextCompletionPort 経由で要約を試行する。
 */
export class OpenAiCompatibleDocumentSummaryInferenceAdapter implements DocumentSummaryInferencePort {
  constructor(private readonly text: TextCompletionPort) {}

  async trySummarize(normalizedText: string): Promise<string | null> {
    const maxIn = env.INFERENCE_DOCUMENT_SUMMARY_INPUT_MAX_CHARS;
    const truncated = normalizedText.slice(0, maxIn);
    if (truncated.trim().length < 20) {
      return null;
    }
    try {
      const { rawText } = await this.text.complete({
        useCase: 'document_summary',
        messages: [
          { role: 'system', content: KIOSK_DOCUMENT_SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: buildKioskDocumentSummaryUserMessage(truncated) },
        ],
        maxTokens: env.INFERENCE_DOCUMENT_SUMMARY_MAX_TOKENS,
        temperature: env.INFERENCE_DOCUMENT_SUMMARY_TEMPERATURE,
        enableThinking: false,
      });
      const clipped = collapseAndClip(rawText, 300);
      return clipped.length > 0 ? clipped : null;
    } catch (err) {
      log.warn({ err }, '[KioskDocumentSummaryInference] summarize failed, caller will fallback');
      return null;
    }
  }
}
