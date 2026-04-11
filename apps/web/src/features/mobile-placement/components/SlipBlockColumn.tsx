import { MP_PLACEHOLDER_ORDER, MP_PLACEHOLDER_PART } from '../constants';

import { SlipFieldRow } from './SlipFieldRow';

import type { SlipColumnVariant } from '../types';

const HEADING: Record<SlipColumnVariant, string> = {
  transfer: '移動票',
  actual: '現品票'
};

const blockClass: Record<SlipColumnVariant, string> = {
  transfer: 'border-l-sky-400 bg-sky-500/[0.06]',
  actual: 'border-l-purple-400 bg-purple-500/[0.06]'
};

const headingClass: Record<SlipColumnVariant, string> = {
  transfer: 'text-sky-300',
  actual: 'text-purple-300'
};

export type SlipBlockColumnProps = {
  variant: SlipColumnVariant;
  manufacturingOrderField: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    onScan: () => void;
  };
  partNumberField: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    onScan: () => void;
  };
};

/**
 * 移動票 / 現品票の1列（見出し + 製造order行 + 部品番号行）
 */
export function SlipBlockColumn(props: SlipBlockColumnProps) {
  const { variant } = props;
  const prefix = variant === 'transfer' ? '移動票' : '現品票';

  return (
    <div className={`rounded-[10px] border-l-[3px] px-2.5 py-2 ${blockClass[variant]}`}>
      <h3 className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${headingClass[variant]}`}>
        {HEADING[variant]}
      </h3>
      <div className="flex flex-col gap-1.5">
        <SlipFieldRow
          fieldId={props.manufacturingOrderField.id}
          value={props.manufacturingOrderField.value}
          onChange={props.manufacturingOrderField.onChange}
          onScan={props.manufacturingOrderField.onScan}
          placeholder={MP_PLACEHOLDER_ORDER}
          ariaLabel={`${prefix} ${MP_PLACEHOLDER_ORDER}`}
        />
        <SlipFieldRow
          fieldId={props.partNumberField.id}
          value={props.partNumberField.value}
          onChange={props.partNumberField.onChange}
          onScan={props.partNumberField.onScan}
          placeholder={MP_PLACEHOLDER_PART}
          ariaLabel={`${prefix} ${MP_PLACEHOLDER_PART}`}
        />
      </div>
    </div>
  );
}
