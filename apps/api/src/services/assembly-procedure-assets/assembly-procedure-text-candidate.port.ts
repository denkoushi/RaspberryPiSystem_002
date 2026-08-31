import type {
  CoordinateOcrPort,
  PdfTextCandidateInput as GenericPdfTextCandidateInput,
  PdfTextCandidatePort as GenericPdfTextCandidatePort,
  PdfTextPort,
  TextCandidate,
  TextCandidateBounds,
  TextCandidateInput,
  TextCandidatePort
} from '../image-region/text-candidate.port.js';

/** @deprecated Use TextCandidateBounds from the domain-neutral module. */
export type AssemblyProcedureTextCandidateBounds = TextCandidateBounds;

/** @deprecated Use TextCandidate from the domain-neutral module. */
export type AssemblyProcedureTextCandidate = TextCandidate;

/** @deprecated Use TextCandidateInput from the domain-neutral module. */
export type AssemblyProcedureTextCandidateInput = TextCandidateInput;

/** @deprecated Use PdfTextCandidateInput from the domain-neutral module. */
export type AssemblyProcedurePdfTextCandidateInput = GenericPdfTextCandidateInput;

/**
 * Compatibility port for existing assembly services. New document domains
 * should depend on TextCandidatePort instead.
 */
export interface AssemblyProcedureTextCandidatePort extends TextCandidatePort {}

/** Compatibility PDF boundary retained for existing composition roots. */
export interface AssemblyProcedurePdfTextCandidatePort
  extends GenericPdfTextCandidatePort {}

/** Stable dependency aliases for existing assembly composition roots. */
export type AssemblyProcedureCoordinateOcrPort = CoordinateOcrPort;
export type AssemblyProcedurePdfTextPort = PdfTextPort;
export type PdfTextCandidatePort = AssemblyProcedurePdfTextCandidatePort;
export type PopplerTextCandidatePort = AssemblyProcedurePdfTextCandidatePort;
