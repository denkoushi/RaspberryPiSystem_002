import { KioskFilterCombobox } from '../../components/kiosk/KioskFilterCombobox';

import type { SelfInspectionFilterOption } from './selfInspectionTableModel';

type Props = {
  ariaLabel: string;
  value: string;
  placeholder: string;
  options: readonly SelfInspectionFilterOption[];
  className?: string;
  dropdownClassName?: string;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
};

export function SelfInspectionFilterCombobox({
  ariaLabel,
  value,
  placeholder,
  options,
  className,
  dropdownClassName,
  onChange,
  onSelect
}: Props) {
  return (
    <KioskFilterCombobox
      ariaLabel={ariaLabel}
      value={value}
      placeholder={placeholder}
      options={options}
      className={className}
      dropdownClassName={dropdownClassName}
      emptyMessage="表示中アイテムに候補がありません"
      onChange={onChange}
      onSelect={onSelect}
    />
  );
}
