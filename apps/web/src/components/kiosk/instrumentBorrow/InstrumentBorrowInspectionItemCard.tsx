import type { InspectionItem } from '../../../api/types';

export type InstrumentBorrowInspectionItemCardProps = {
  item: InspectionItem;
  isNg: boolean;
};

/**
 * 点検項目 1 件の表示（プレビューのカード見た目に合わせたプレゼンテーションのみ）
 */
export function InstrumentBorrowInspectionItemCard({ item, isNg }: InstrumentBorrowInspectionItemCardProps) {
  return (
    <div className="w-full rounded-md border-2 border-slate-300 bg-slate-100 p-2.5 shadow-md">
      <p className="text-base font-bold text-slate-900">{item.name}</p>
      <p className="text-sm text-slate-700">内容: {item.content}</p>
      <p className="text-sm text-slate-700">基準: {item.criteria}</p>
      <p className="text-sm text-slate-700">方法: {item.method}</p>
      {isNg ? <p className="mt-1.5 text-xs font-semibold text-slate-700">❌ NG</p> : null}
    </div>
  );
}
