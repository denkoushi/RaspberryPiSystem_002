import { normalizeWorkInstructionPartNumber } from '../../lib/workInstructionRules';
import { api } from '../http';

/**
 * A current SCAW nonconformity projection.  The API has already resolved the
 * manufacturing-order enrichment during ingestion; the kiosk only renders
 * this persisted read model.
 */
export type SelfInspectionNonconformity = {
  id: string;
  discoveredOn: string | null;
  originDepartmentName: string | null;
  remarks: string | null;
  nonconformityContent: string | null;
  dispositionContent: string | null;
  correctiveContent1: string | null;
  correctiveContent2: string | null;
  partName: string | null;
  machineName: string | null;
};

export type SelfInspectionNonconformityResponse = {
  count: number;
  items: SelfInspectionNonconformity[];
};

/**
 * Reads active rows from the persisted current projection for one canonical
 * FHINCD.  No production-schedule lookup is performed from the browser.
 */
export async function getSelfInspectionNonconformities(
  partNumber: string,
  signal?: AbortSignal
): Promise<SelfInspectionNonconformity[]> {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  if (!normalizedPartNumber) return [];

  const { data } = await api.get<SelfInspectionNonconformityResponse>(
    '/kiosk/self-inspection/nonconformities',
    {
      params: { partNumber: normalizedPartNumber },
      signal
    }
  );
  return data.items;
}
