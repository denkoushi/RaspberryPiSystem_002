import type { LeaderBoardRow } from '../types';

/** テスト用の最小 LeaderBoardRow（requiredMinutes 既定 0） */
export function mkLeaderBoardRow(partial: Partial<LeaderBoardRow> & Pick<LeaderBoardRow, 'id'>): LeaderBoardRow {
  return {
    seibanJoinKey: partial.fseiban ?? partial.seibanJoinKey ?? 'S1',
    resourceCd: '305',
    dueDate: null,
    plannedEndDate: null,
    displayDue: null,
    fseiban: 'S1',
    productNo: '',
    fkojun: '',
    fhincd: '',
    fhinmei: '',
    customerName: '',
    machineName: '',
    machineTypeCode: '',
    plannedQuantity: null,
    processingOrder: null,
    machineRequiredMinutes: 0,
    laborRequiredMinutes: 0,
    requiredMinutes: 0,
    isCompleted: false,
    note: null,
    hasSelfInspectionDrawing: false,
    selfInspectionTemplateId: null,
    selfInspectionStatus: null,
    selfInspectionEntryPath: null,
    sourceRowId: partial.sourceRowId ?? partial.id,
    splitId: null,
    splitNo: null,
    splitQuantity: null,
    isSplit: false,
    ...partial
  };
}
