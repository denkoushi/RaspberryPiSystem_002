import type { KnowledgeProcedureReviewTier } from '@raspi-system/shared-types';

import type { ProcedureHeader, TitleParts } from './procedure-content.js';

// Mirrored by the DB CHECK in migration 20260927160000_add_knowledge_triage.
export const TRIAGE_STATES = ['suggesting', 'awaiting', 'decided'] as const;
export type TriageState = typeof TRIAGE_STATES[number];

export type ProcedureIdentifiers = ProcedureHeader['identifiers'];

/** Stored AI suggestions for one post. Titles and ids are validated against existing topics by code. */
export type TriageSuggestions = {
  candidates: { procedureId: string; title: string; reason: string }[];
  proposal: { parts: TitleParts; title: string; identifiers: ProcedureIdentifiers; reviewTier: KnowledgeProcedureReviewTier; reason: string } | null;
  confidence: number;
};

export type Triage = {
  intakeId: string;
  posterEmployeeId: string | null;
  state: TriageState;
  suggestions: TriageSuggestions | null;
  decidedProcedureId: string | null;
  createdAt: Date;
};

export type TriageDestination =
  | { procedureId: string }
  | { newTopic: { parts: TitleParts; identifiers: ProcedureIdentifiers; reviewTier: KnowledgeProcedureReviewTier } };

export interface TriageRepositoryPort {
  /** Idempotent: one triage per post. */
  open(intakeId: string, posterEmployeeId: string | null): Promise<void>;
  claimSuggesting(token: string): Promise<Triage | null>;
  saveSuggestions(intakeId: string, token: string, suggestions: TriageSuggestions): Promise<void>;
  failSuggesting(intakeId: string, token: string, errorCode: string, deferred: boolean): Promise<void>;
  get(intakeIds: string[]): Promise<Triage[]>;
  awaitingFor(employeeId: string): Promise<Triage[]>;
  /**
   * Assigns every material of the post to the destination and requests a rebuild of that topic,
   * atomically. Only the poster may decide, and only while the triage is awaiting a decision.
   */
  decide(intakeId: string, employeeId: string, destination: TriageDestination): Promise<{ procedureId: string }>;
}
