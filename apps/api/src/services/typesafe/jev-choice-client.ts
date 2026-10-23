export const JEV_CHOICE_MODEL = 'jev-1.13.0';

export type JevImageAsset = { type: 'image'; format: 'jpeg'; data_base64: string };

/** One image choice question. Bound both fetch and body decoding, even if cancellation is ignored. */
export async function requestJevChoice(input: {
  apiKey: string;
  timeoutMs: number;
  state: Record<string, string>;
  instructions: string;
  criteria: Record<string, string>;
  assets: Record<string, JevImageAsset>;
  fetch?: typeof fetch;
}): Promise<Record<string, number>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('JEV choice timed out'));
    }, input.timeoutMs);
  });
  const request = async () => {
    const response = await (input.fetch ?? globalThis.fetch)('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'TypeSafe-Danger-Zone-Images': 'true'
      },
      body: JSON.stringify({
        model: JEV_CHOICE_MODEL,
        state: input.state,
        questions: { q: { type: 'choice', instructions: input.instructions, criteria: input.criteria } },
        assets: input.assets
      })
    });
    if (!response.ok) throw new Error('JEV choice upstream failed');
    const result = await response.json();
    const probabilities: unknown = result?.answers?.q?.probabilities;
    if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) {
      throw new Error('Invalid JEV probabilities');
    }
    const values = probabilities as Record<string, unknown>;
    const validated: Record<string, number> = {};
    for (const key of Object.keys(input.criteria)) {
      const value = values[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('Invalid JEV probability');
      }
      validated[key] = value;
    }
    return validated;
  };
  try { return await Promise.race([request(), timeout]); }
  finally { clearTimeout(timer); }
}
