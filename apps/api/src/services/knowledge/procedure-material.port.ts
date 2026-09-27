import type { KnowledgeSource, OrganizedNote } from './knowledge-source.js';

// Mirrored by the DB CHECK in migration 20260927140000_add_knowledge_procedure_materials.
export const PROCEDURE_MATERIAL_STATES = ['pending', 'assigned', 'unassigned', 'failed'] as const;
export type ProcedureMaterialState = typeof PROCEDURE_MATERIAL_STATES[number];

/** One organized knowledge source (a note with photos, or one PDF page). */
export type ProcedureMaterial = {
  id: string;
  intakeId: string;
  source: KnowledgeSource;
  organized: OrganizedNote;
  state: ProcedureMaterialState;
  procedureId: string | null;
  attempts: number;
  createdAt: Date;
};

export interface ProcedureMaterialRepositoryPort {
  /** Idempotent per source id, so a retried intake does not queue a source twice. */
  enqueue(intakeId: string, items: { source: KnowledgeSource; organized: OrganizedNote }[]): Promise<void>;
  /** Claims the oldest due material under a lease; null when nothing is due. */
  claim(token: string): Promise<ProcedureMaterial | null>;
  renew(id: string, token: string): Promise<boolean>;
  /** Assigned materials of one procedure, oldest first, bounded by `limit`. */
  materialsOf(procedureId: string, limit: number): Promise<ProcedureMaterial[]>;
  finish(id: string, token: string, outcome: { procedureId: string } | { unassigned: true }): Promise<void>;
  fail(id: string, token: string, errorCode: string, deferred: boolean): Promise<void>;
  /** Gives failed materials a fresh set of attempts, e.g. after a release that may fix the cause. */
  requeueFailed(): Promise<number>;
}
