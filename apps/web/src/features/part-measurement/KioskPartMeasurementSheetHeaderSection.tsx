import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { PartMeasurementSheetDto } from './types';

export type KioskPartMeasurementSheetHeaderSectionProps = {
  sheet: PartMeasurementSheetDto;
  quantityInput: string;
  onQuantityChange: (value: string) => void;
  readOnly: boolean;
};

/**
 * キオスク部品測定の「ヘッダ」ブロック。表示レイアウトのみを担当（入力の state は呼び出し側）。
 */
export function KioskPartMeasurementSheetHeaderSection({
  sheet,
  quantityInput,
  onQuantityChange,
  readOnly
}: KioskPartMeasurementSheetHeaderSectionProps) {
  return (
    <Card title="ヘッダ">
      <dl className="flex flex-wrap items-start gap-x-6 gap-y-3 text-sm">
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-600">製番</dt>
          <dd className="font-semibold text-slate-900">{sheet.fseiban}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-600">製造order</dt>
          <dd className="font-semibold text-slate-900">{sheet.productNo}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-600">品番</dt>
          <dd className="font-semibold text-slate-900">{sheet.fhincd}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-600">資源CD</dt>
          <dd className="font-semibold text-slate-900">{sheet.resourceCdSnapshot ?? '—'}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-600">工程</dt>
          <dd className="font-semibold text-slate-900">
            {sheet.processGroupSnapshot === 'grinding' ? '研削' : '切削'}
          </dd>
        </div>
        <div className="min-w-[12rem] max-w-[28rem] shrink-0">
          <dt className="text-slate-600">作業者（確定前NFC）</dt>
          <dd className="font-semibold text-slate-900">
            {sheet.employeeNameSnapshot ?? 'NFCで社員タグをスキャン'}
          </dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-600">作成者</dt>
          <dd className="font-semibold text-slate-900">{sheet.createdByEmployeeNameSnapshot ?? '—'}</dd>
        </div>
        <div className="min-w-[9rem] max-w-[22rem] shrink-0">
          <dt className="text-slate-600">確定者</dt>
          <dd className="font-semibold text-slate-900">{sheet.finalizedByEmployeeNameSnapshot ?? '—'}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex w-[14ch] max-w-full flex-col gap-1 text-sm font-semibold text-slate-700">
          個数
          <Input
            value={quantityInput}
            onChange={(e) => onQuantityChange(e.target.value)}
            inputMode="numeric"
            disabled={readOnly}
            className="text-slate-900"
          />
        </label>
      </div>
    </Card>
  );
}
