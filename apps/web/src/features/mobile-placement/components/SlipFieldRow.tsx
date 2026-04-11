import { IconScanButton } from './IconScanButton';

export type SlipFieldRowProps = {
  fieldId: string;
  value: string;
  placeholder: string;
  /** 入力とスキャンボタンに共通の説明（sr-only / aria） */
  ariaLabel: string;
  onChange: (value: string) => void;
  onScan: () => void;
};

/**
 * 照合: 1行 = 入力 + 右にバーコードスキャン（上半の field-row と同等）
 */
export function SlipFieldRow(props: SlipFieldRowProps) {
  return (
    <div className="flex items-stretch gap-1.5">
      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor={props.fieldId}>
          {props.ariaLabel}
        </label>
        <input
          id={props.fieldId}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          autoComplete="off"
          className="h-10 w-full rounded-md border border-white/35 bg-slate-950 px-2.5 text-sm text-white placeholder:text-slate-400"
          aria-label={props.ariaLabel}
        />
      </div>
      <IconScanButton
        variant="slip"
        title="スキャン"
        aria-label={`${props.ariaLabel}をスキャン`}
        onClick={props.onScan}
      />
    </div>
  );
}
