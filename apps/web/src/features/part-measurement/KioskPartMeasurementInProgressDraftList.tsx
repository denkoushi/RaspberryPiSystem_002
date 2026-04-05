import { Link } from 'react-router-dom';

import { formatKioskPartMeasurementDraftUpdatedAt } from './formatKioskPartMeasurementDraftUpdatedAt';

import type { PartMeasurementSheetDto } from './types';

export type KioskPartMeasurementInProgressDraftListProps = {
  drafts: PartMeasurementSheetDto[];
};

function processGroupLabel(group: PartMeasurementSheetDto['processGroupSnapshot']): string {
  return group === 'grinding' ? '研削' : '切削';
}

export function KioskPartMeasurementInProgressDraftList({ drafts }: KioskPartMeasurementInProgressDraftListProps) {
  return (
    <div className="max-h-[min(50vh,32rem)] overflow-auto">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {drafts.map((d) => {
          const fhinmei = d.fhinmei?.trim() ?? '';
          const machineName = d.machineName?.trim() ?? '';
          return (
            <div key={d.id} className="min-w-0">
              <Link
                to={`/kiosk/part-measurement/edit/${d.id}`}
                aria-label={`測定値入力中の記録を開く、製造order ${d.productNo}、品番 ${d.fhincd}`}
                className="block break-words rounded border border-slate-200 bg-white p-3 text-left text-sm text-slate-800 shadow-sm outline-none ring-offset-2 hover:border-blue-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <p className="font-semibold text-blue-700 underline decoration-blue-600">
                  製造order {d.productNo} / 品番 {d.fhincd} / 資源 {d.resourceCdSnapshot ?? '—'} / 工程{' '}
                  {processGroupLabel(d.processGroupSnapshot)}
                </p>
                <p className="mt-2 whitespace-normal break-words text-slate-800">
                  <span className="font-semibold text-slate-700">部品名称（FHINMEI）</span> {fhinmei || '—'}
                </p>
                <p className="mt-1 whitespace-normal break-words text-slate-800">
                  <span className="font-semibold text-slate-700">機種名</span> {machineName || '—'}
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  更新 {formatKioskPartMeasurementDraftUpdatedAt(d.updatedAt)}
                </p>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
