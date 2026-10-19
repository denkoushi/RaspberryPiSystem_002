import type { VisionCompletionInput } from './vision-completion.port.js';

export type MultiImageVisionCompletionInput = Omit<VisionCompletionInput, 'imageBytes' | 'mimeType'> & {
  images: Array<{ imageBytes: Buffer; mimeType: 'image/jpeg'; label: string }>;
};
export interface MultiImageVisionCompletionPort {
  completeMany(input: MultiImageVisionCompletionInput): Promise<{ rawText: string; modelRoute: string; modelName: string }>;
}

/** Connectivity, unavailable runtime or background admission: retry without charging an attempt. */
export class InferenceUnavailableError extends Error {
  constructor() { super('Inference temporarily unavailable'); this.name = 'InferenceUnavailableError'; }
}
