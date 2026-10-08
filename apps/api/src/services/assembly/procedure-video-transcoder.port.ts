export type ProcedureVideoProbe = { durationSeconds: number; width: number; height: number; sampleAspectRatio?: number };

export interface ProcedureVideoTranscoderPort {
  posterAt(input: string, poster: string, startSeconds: number): Promise<void>;
  probe(input: string): Promise<ProcedureVideoProbe>;
  trim(input: string, output: string, poster: string, startSeconds: number, endSeconds: number, onStepComplete?: () => Promise<void>): Promise<void>;
  transcode(input: string, output: string, poster: string, onStepComplete?: () => Promise<void>): Promise<void>;
  concat(inputs: string[], output: string, poster: string, onStepComplete?: () => Promise<void>): Promise<void>;
}

export class ProcedureVideoTranscodeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
