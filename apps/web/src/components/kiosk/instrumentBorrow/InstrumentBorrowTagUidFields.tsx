import { Input } from '../../ui/Input';

import type { KeyboardEvent, RefObject } from 'react';

export type InstrumentBorrowTagUidFieldsProps = {
  instrumentTagUid: string;
  onInstrumentTagUidChange: (value: string) => void;
  instrumentInputDisabled: boolean;
  instrumentPlaceholder?: string;
  instrumentRequired: boolean;
  employeeTagUid: string;
  onEmployeeTagUidChange: (value: string) => void;
  onEmployeeKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  employeeInputRef: RefObject<HTMLInputElement>;
  employeeInputDisabled: boolean;
  employeePlaceholder?: string;
};

/**
 * 計測機器タグUID と氏名タグUIDを横並び（狭い幅では縦積み）で表示するプレゼンテーション。
 * 状態・分岐は親（ページ）に集約し、ここは入力の見た目とレイアウトのみを担当する。
 */
export function InstrumentBorrowTagUidFields({
  instrumentTagUid,
  onInstrumentTagUidChange,
  instrumentInputDisabled,
  instrumentPlaceholder = 'スキャンまたは手入力',
  instrumentRequired,
  employeeTagUid,
  onEmployeeTagUidChange,
  onEmployeeKeyDown,
  employeeInputRef,
  employeeInputDisabled,
  employeePlaceholder = 'スキャンまたは手入力（OKの場合は自動送信）'
}: InstrumentBorrowTagUidFieldsProps) {
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
      <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">
        計測機器タグUID
        <Input
          className="mt-1 w-full"
          value={instrumentTagUid}
          onChange={(e) => onInstrumentTagUidChange(e.target.value)}
          required={instrumentRequired}
          placeholder={instrumentPlaceholder}
          disabled={instrumentInputDisabled}
        />
      </label>
      <div className="min-w-0 flex-1">
        <label className="block text-sm font-semibold text-slate-700" htmlFor="instrument-borrow-employee-tag-uid">
          氏名タグUID
        </label>
        <div className="mt-1">
          <Input
            id="instrument-borrow-employee-tag-uid"
            ref={employeeInputRef}
            value={employeeTagUid}
            onChange={(e) => onEmployeeTagUidChange(e.target.value)}
            onKeyDown={onEmployeeKeyDown}
            required
            placeholder={employeePlaceholder}
            disabled={employeeInputDisabled}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
