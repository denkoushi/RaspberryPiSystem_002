import type { ProcedureManualProcessDto } from '../types';

export const procedureManualShortProcessName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

export function splitProcedureManualName(name: string) {
  const parts = name.split('_').map(part => part.trim());
  if (parts.length < 4) return null;
  const [partName, subjectKey, process, work, ...supplement] = parts;
  return { partName, subjectKey, process, work, supplement: supplement.join(' ').trim() };
}

export function buildProcedureManualName(subjectKey: string, partName: string | null | undefined,
  parent?: ProcedureManualProcessDto, child?: ProcedureManualProcessDto, supplement = '') {
  return [partName?.replace(/_/g, ' ').trim(), subjectKey, procedureManualShortProcessName(parent),
    procedureManualShortProcessName(child), supplement.trim()].filter(Boolean).join('_');
}

/** Joins already-split fields back into a name; underscores typed inside a field become spaces. */
export function joinProcedureManualName(fields: Array<string | null | undefined>) {
  return fields.map(field => field?.replace(/_/g, ' ').trim()).filter(Boolean).join('_');
}
