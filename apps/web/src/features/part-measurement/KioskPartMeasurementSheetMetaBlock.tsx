import { Input } from '../../components/ui/Input';

import type { PartMeasurementSheetDto } from './types';

export type KioskPartMeasurementSheetMetaBlockProps = {
  sheet: PartMeasurementSheetDto;
  quantityInput: string;
  onQuantityChange: (value: string) => void;
  readOnly: boolean;
};

/**
 * キオスク部品測定のシートメタ（製番・個数等）。暗いトップ帯上での表示用スタイルのみ。
 */
export function KioskPartMeasurementSheetMetaBlock({
  sheet,
  quantityInput,
  onQuantityChange,
  readOnly
}: KioskPartMeasurementSheetMetaBlockProps) {
  return (
    <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-2 text-sm">
      <dl className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-400">製番</dt>
          <dd className="font-semibold text-white">{sheet.fseiban}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-400">製造order</dt>
          <dd className="font-semibold text-white">{sheet.productNo}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-400">品番</dt>
          <dd className="font-semibold text-white">{sheet.fhincd}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-400">資源CD</dt>
          <dd className="font-semibold text-white">{sheet.resourceCdSnapshot ?? '—'}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-400">工程</dt>
          <dd className="font-semibold text-white">
            {sheet.processGroupSnapshot === 'grinding' ? '研削' : '切削'}
          </dd>
        </div>
        <div className="min-w-[12rem] max-w-[28rem] shrink-0">
          <dt className="text-slate-400">作業者（確定前NFC）</dt>
          <dd className="font-semibold text-white">
            {sheet.employeeNameSnapshot ?? 'NFCで社員タグをスキャン'}
          </dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-400">作成者</dt>
          <dd className="font-semibold text-white">{sheet.createdByEmployeeNameSnapshot ?? '—'}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-400">確定者</dt>
          <dd className="font-semibold text-white">{sheet.finalizedByEmployeeNameSnapshot ?? '—'}</dd>
        </div>
      </dl>
      <label className="flex w-[14ch] max-w-full flex-col gap-1 text-sm font-semibold text-slate-300">
        個数
        <Input
          value={quantityInput}
          onChange={(e) => onQuantityChange(e.target.value)}
          inputMode="numeric"
          disabled={readOnly}
          className="border-slate-500 bg-white text-slate-900"
        />
      </label>
    </div>
  );
}
