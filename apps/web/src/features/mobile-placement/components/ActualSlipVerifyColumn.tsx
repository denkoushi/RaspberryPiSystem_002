import { Button } from '../../../components/ui/Button';
import { MP_PLACEHOLDER_ORDER, MP_PLACEHOLDER_PART } from '../constants';

import { SlipFieldRow } from './SlipFieldRow';

const blockClass = 'border-l-purple-400 bg-purple-500/[0.06]';

/**
 * 現品票列: 製造order（任意・OCR可）+ 製番（任意）+ 部品（FHINBAN バーコード）
 */
export type ActualSlipVerifyColumnProps = {
  manufacturingOrderField: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    onScan: () => void;
  };
  fseibanField: {
    id: string;
    value: string;
    onChange: (v: string) => void;
  };
  partNumberField: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    onScan: () => void;
  };
  onImageOcr: () => void;
  imageOcrBusy: boolean;
};

export function ActualSlipVerifyColumn(props: ActualSlipVerifyColumnProps) {
  return (
    <div className={`rounded-[10px] border-l-[3px] px-2.5 py-2 ${blockClass}`}>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-purple-300">現品票</h3>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-stretch gap-1">
          <div className="min-w-0 flex-1">
            <SlipFieldRow
              fieldId={props.manufacturingOrderField.id}
              value={props.manufacturingOrderField.value}
              onChange={props.manufacturingOrderField.onChange}
              onScan={props.manufacturingOrderField.onScan}
              placeholder={MP_PLACEHOLDER_ORDER}
              ariaLabel={`現品票 ${MP_PLACEHOLDER_ORDER}`}
            />
          </div>
          <Button
            type="button"
            variant="ghostOnDark"
            className="h-10 shrink-0 px-2 text-[11px] !text-white"
            disabled={props.imageOcrBusy}
            onClick={props.onImageOcr}
            aria-label="現品票を撮影してOCR"
          >
            {props.imageOcrBusy ? '…' : '画像OCR'}
          </Button>
        </div>
        <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-purple-200/90">
          製番（任意・OCRまたは手入力）
          <input
            id={props.fseibanField.id}
            value={props.fseibanField.value}
            onChange={(e) => props.fseibanField.onChange(e.target.value)}
            placeholder="FSEIBAN"
            autoComplete="off"
            className="h-10 w-full rounded-md border border-white/35 bg-slate-950 px-2.5 text-sm text-white placeholder:text-slate-400"
            aria-label="現品票 製番"
          />
        </label>
        <SlipFieldRow
          fieldId={props.partNumberField.id}
          value={props.partNumberField.value}
          onChange={props.partNumberField.onChange}
          onScan={props.partNumberField.onScan}
          placeholder={MP_PLACEHOLDER_PART}
          ariaLabel={`現品票 ${MP_PLACEHOLDER_PART}`}
        />
      </div>
    </div>
  );
}
