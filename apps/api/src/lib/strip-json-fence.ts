/** Removes a surrounding ```json … ``` (or bare ```) fence that LLMs often wrap JSON answers in. */
export function stripJsonFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
}
