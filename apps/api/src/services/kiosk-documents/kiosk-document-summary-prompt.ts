import { INFERENCE_PROMPT_DEFAULTS } from '../inference/prompts/inference-prompt-registry.js';

/** 要領書要約: システム指示（業務側プロンプト） */
export const KIOSK_DOCUMENT_SUMMARY_SYSTEM_PROMPT = INFERENCE_PROMPT_DEFAULTS.documentSummarySystemPrompt;

export function buildKioskDocumentSummaryUserMessage(truncatedNormalizedText: string): string {
  return (
    '以下はPDF/OCRで抽出したテキストです。重要な目的・範囲・手順の要点を200文字以内を目安に要約してください。\n\n' +
    truncatedNormalizedText
  );
}
