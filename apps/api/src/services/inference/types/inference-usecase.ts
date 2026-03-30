export const INFERENCE_USE_CASES = ['photo_label', 'document_summary'] as const;

export type InferenceUseCase = (typeof INFERENCE_USE_CASES)[number];

export function isInferenceUseCase(value: string): value is InferenceUseCase {
  return (INFERENCE_USE_CASES as readonly string[]).includes(value);
}
