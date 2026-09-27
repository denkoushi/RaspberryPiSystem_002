import { api } from '../../api/http';

import type { KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

export async function listKnowledgeProcedures(signal?: AbortSignal): Promise<KnowledgeProcedureSummary[]> {
  const { data } = await api.get<{ procedures: KnowledgeProcedureSummary[] }>('/hermes-knowledge/procedures', { signal });
  return data.procedures;
}

export async function getKnowledgeProcedure(procedureId: string, signal?: AbortSignal): Promise<KnowledgeProcedureDocument> {
  const { data } = await api.get<{ procedure: KnowledgeProcedureDocument }>(
    `/hermes-knowledge/procedures/${encodeURIComponent(procedureId)}`, { signal },
  );
  return data.procedure;
}
