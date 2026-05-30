import clsx from 'clsx';
import { useId } from 'react';

import {
  inspectionDrawingBoundedSelectClassName,
  inspectionDrawingBoundedSelectShellClassName,
  inspectionDrawingLibraryFilterFieldLabelClassName,
  inspectionDrawingLibraryFilterResourceWidthClass,
  inspectionDrawingMetadataLabelClassName,
  inspectionDrawingMetadataResourceFieldWidthClass
} from './inspectionDrawingKioskUi';

export type InspectionDrawingResourceCdSelectOption = {
  value: string;
  label: string;
};

export type InspectionDrawingResourceCdSelectWidthVariant = 'library' | 'metadata';

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<InspectionDrawingResourceCdSelectOption>;
  emptyOptionLabel: string;
  widthVariant: InspectionDrawingResourceCdSelectWidthVariant;
  label?: string;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

const FIELD_WIDTH_BY_VARIANT: Record<InspectionDrawingResourceCdSelectWidthVariant, string> = {
  library: inspectionDrawingLibraryFilterResourceWidthClass,
  metadata: inspectionDrawingMetadataResourceFieldWidthClass
};

/**
 * キオスク検査図面向けの資源 CD ネイティブ select。
 * 長い表示ラベルでも隣接 UI と重ならないよう overflow-hidden シェルで包む。
 */
export function InspectionDrawingResourceCdSelect({
  value,
  onChange,
  options,
  emptyOptionLabel,
  widthVariant,
  label = '資源',
  id: idProp,
  disabled = false,
  ariaLabel
}: Props) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const labelClassName =
    widthVariant === 'library'
      ? inspectionDrawingLibraryFilterFieldLabelClassName
      : inspectionDrawingMetadataLabelClassName;

  return (
    <div className={clsx('grid gap-1', FIELD_WIDTH_BY_VARIANT[widthVariant])}>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <div className={inspectionDrawingBoundedSelectShellClassName}>
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          onChange={(e) => onChange(e.target.value)}
          className={inspectionDrawingBoundedSelectClassName}
        >
          <option value="">{emptyOptionLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
