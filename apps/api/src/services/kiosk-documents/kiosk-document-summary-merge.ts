import { buildSummaryCandidates } from './kiosk-document-summary-candidates.js';

function distinctEnough(a: string, b: string): boolean {
  const short = a.length < 12 || b.length < 12;
  if (short) {
    return a !== b;
  }
  const prefix = Math.min(20, a.length, b.length);
  return a.slice(0, prefix) !== b.slice(0, prefix);
}

/**
 * LLM 要約を優先して candidate1 に載せ、2–3 は機械スニペットで埋める（重複は避ける）。
 */
export function mergeSummaryCandidatesWithLlmFirst(
  normalizedText: string,
  llmSummary: string | null
): [string | undefined, string | undefined, string | undefined] {
  const [m1, m2, m3] = buildSummaryCandidates(normalizedText);
  if (!llmSummary || llmSummary.trim().length === 0) {
    return [m1, m2, m3];
  }
  const out: string[] = [llmSummary.trim()];
  for (const cand of [m1, m2, m3]) {
    if (!cand) continue;
    if (out.some((x) => !distinctEnough(x, cand))) continue;
    out.push(cand);
    if (out.length >= 3) break;
  }
  return [out[0], out[1], out[2]];
}
