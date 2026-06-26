import {
  SelfInspectionWorkflowModal,
  type SelfInspectionWorkflowTarget
} from '../../part-measurement/SelfInspectionWorkflowModal';

import { resolveSourceRowIdFromLeaderBoardRow } from './displayItemId';

import type { LeaderBoardRow } from './types';

type Props = {
  row: LeaderBoardRow | null;
  onClose: () => void;
  onOpenDigitalInput: (row: LeaderBoardRow) => void;
  onOpenPaperPrint: (row: LeaderBoardRow) => void;
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
    selfInspectionEntryPath: row.selfInspectionEntryPath
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
      onOpenDigitalInput={() => {
        if (row) onOpenDigitalInput(row);
      }}
      onOpenPaperPrint={() => {
        if (row) onOpenPaperPrint(row);
      }}
    />
  );
}
