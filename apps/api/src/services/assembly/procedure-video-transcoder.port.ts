export type ProcedureVideoProbe = { durationSeconds: number; width: number; height: number };

export interface ProcedureVideoTranscoderPort {
  probe(input: string): Promise<ProcedureVideoProbe>;
  transcode(input: string, output: string, poster: string): Promise<void>;
}

export class ProcedureVideoTranscodeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
