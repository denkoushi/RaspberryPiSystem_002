import { useEffect } from 'react';

import { normalizeWorkInstructionPartNumber } from '../../../lib/workInstructionRules';
import { claimKeyboardWedgeScanOwner, releaseKeyboardWedgeScanOwner, useKeyboardWedgeScan } from '../../barcode-scan/useKeyboardWedgeScan';

import { procedureManualButtonBase, procedureManualButtonSelected, procedureManualButtonUnselected } from './procedure-manual-button-styles';
import { ProcedureManualPartLabel } from './ProcedureManualPartLabel';

import type { ProcedureManualPartCandidateDto } from '../../../api/client';

export function useProcedureManualPartScan(owner: string, active: boolean, onScan: (key: string) => void) {
  // Reserve input even while unarmed so a scan never reaches the list behind the dialog.
  useEffect(() => {
    claimKeyboardWedgeScanOwner(owner);
    return () => releaseKeyboardWedgeScanOwner(owner);
  }, [owner]);
  useKeyboardWedgeScan({ owner, active, onScan: text => onScan(normalizeWorkInstructionPartNumber(text)) });
}

export function ProcedureManualPartCandidateButton({ part, selected, onSelect, disabled = false,
  selectedClassName = procedureManualButtonSelected }: {
  part: ProcedureManualPartCandidateDto; selected: boolean; onSelect: () => void; disabled?: boolean; selectedClassName?: string;
}) {
  return <button type="button" aria-label={part.partNumberKey} aria-pressed={selected} disabled={disabled}
    className={`${procedureManualButtonBase} shrink-0 px-3 text-left text-xl break-all disabled:opacity-40 ${selected ? selectedClassName : procedureManualButtonUnselected}`}
    onClick={onSelect}><ProcedureManualPartLabel partNumber={part.partNumber} partName={part.partName} /></button>;
}
