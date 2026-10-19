import type { KnowledgeSource, OrganizedNote } from './knowledge-source.js';

// Mirrored by the DB CHECK in migration 20260927140000_add_knowledge_procedure_materials.
// `pending` waits for the poster's triage decision; `unassigned` and `failed` remain valid for older rows.
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
  createdAt: Date;
};

export interface ProcedureMaterialRepositoryPort {
  /** Idempotent per source id, so a retried intake does not queue a source twice. */
  enqueue(intakeId: string, items: { source: KnowledgeSource; organized: OrganizedNote }[]): Promise<void>;
  /** Materials of one post, in source order. */
  materialsOfIntake(intakeId: string): Promise<ProcedureMaterial[]>;
  /** Assigned materials of one procedure, oldest first, bounded by `limit`. */
  materialsOf(procedureId: string, limit: number): Promise<ProcedureMaterial[]>;
}
