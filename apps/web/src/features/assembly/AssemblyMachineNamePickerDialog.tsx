import { listAssemblyMachineNameCandidates } from '../../api/client';
import { MachineNamePickerDialog } from '../../components/machine/MachineNamePickerDialog';

type Props = {
  isOpen: boolean;
  currentValue: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: (machineName: string) => void;
};

/** Assembly向けの既存API契約を共通機種名Pickerへ渡す互換wrapper。 */
export function AssemblyMachineNamePickerDialog(props: Props) {
  return <MachineNamePickerDialog {...props} loadCandidates={listAssemblyMachineNameCandidates} />;
}
