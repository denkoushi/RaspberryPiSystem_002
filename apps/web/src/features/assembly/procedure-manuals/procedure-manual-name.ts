import type { ProcedureManualProcessDto } from '../types';

export const procedureManualShortProcessName = (process?: ProcedureManualProcessDto) => process?.name.replace(/工程/g, '') ?? '';

export function buildProcedureManualName(subjectKey: string, partName: string | null | undefined,
  parent?: ProcedureManualProcessDto, child?: ProcedureManualProcessDto, supplement = '') {
  return [partName?.replace(/_/g, ' ').trim(), subjectKey, procedureManualShortProcessName(parent),
    procedureManualShortProcessName(child), supplement.trim()].filter(Boolean).join('_');
}
