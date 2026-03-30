/** 要領書要約: システム指示（業務側プロンプト） */
export const KIOSK_DOCUMENT_SUMMARY_SYSTEM_PROMPT =
  'あなたは製造現場の要領書・手順書の要約アシスタントです。与えられたOCRテキストのみを根拠に、日本語で簡潔な要約を1段落で出力してください。' +
  '数値・記号・固有名詞は可能な限り原文どおり残してください。推測で情報を追加しないでください。' +
  '出力は要約本文のみ（見出しや箇条書きラベルは不要）。';

export function buildKioskDocumentSummaryUserMessage(truncatedNormalizedText: string): string {
  return (
    '以下はPDF/OCRで抽出したテキストです。重要な目的・範囲・手順の要点を200文字以内を目安に要約してください。\n\n' +
    truncatedNormalizedText
  );
}
