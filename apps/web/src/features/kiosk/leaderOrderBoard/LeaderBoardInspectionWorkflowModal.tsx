import {
  SelfInspectionWorkflowModal,
  type SelfInspectionWorkflowTarget
} from '../../part-measurement/SelfInspectionWorkflowModal';

import { resolveSourceRowIdFromLeaderBoardRow } from './displayItemId';

import type { LeaderBoardRow } from './types';

type Props = {
  row: LeaderBoardRow | null;
  onClose: () => void;
  onOpenDigitalInput: (row: LeaderBoardRow, resourceCd: string) => void;
  onOpenPaperPrint: (row: LeaderBoardRow, resourceCd: string) => void;
};

function toWorkflowTarget(row: LeaderBoardRow): SelfInspectionWorkflowTarget {
  return {
    productNo: row.productNo,
    scheduleRowId: resolveSourceRowIdFromLeaderBoardRow(row),
    resourceCd: row.resourceCd,
    fseiban: row.fseiban,
    fhincd: row.fhincd,
    fhinmei: row.fhinmei,
    machineName: row.machineName,
    selfInspectionTemplateId: row.selfInspectionTemplateId,
    selfInspectionEntryPath: row.selfInspectionEntryPath,
    selfInspectionResourceCds: row.selfInspectionResourceCds ?? [],
    selfInspectionResourceCd: row.selfInspectionResourceCd ?? null
  };
}

export function LeaderBoardInspectionWorkflowModal({
  row,
  onClose,
  onOpenDigitalInput,
  onOpenPaperPrint
}: Props) {
  return (
    <SelfInspectionWorkflowModal
      target={row ? toWorkflowTarget(row) : null}
      onClose={onClose}
      onOpenDigitalInput={(_target, resourceCd) => {
        if (row) onOpenDigitalInput(row, resourceCd);
      }}
      onOpenPaperPrint={(_target, resourceCd) => {
        if (row) onOpenPaperPrint(row, resourceCd);
      }}
    />
  );
}
