import clsx from 'clsx';

import { formatKioskPartMeasurementDraftUpdatedAt } from './formatKioskPartMeasurementDraftUpdatedAt';

import type { PartMeasurementSessionSummaryDto, PartMeasurementSheetStatus } from './types';

export type KioskPartMeasurementSessionSheetCardsProps = {
  session: PartMeasurementSessionSummaryDto;
  activeSheetId: string;
  onSelectSheet: (sheetId: string) => void;
};

function statusLabel(s: PartMeasurementSheetStatus): string {
  switch (s) {
    case 'DRAFT':
      return '下書き';
    case 'FINALIZED':
      return '確定';
    case 'CANCELLED':
      return '取消';
    case 'INVALIDATED':
      return '無効';
    default:
      return s;
  }
}

/**
 * 同一セッション配下の子記録表をカードで列挙し、選択中のシートを切り替える。
 */
export function KioskPartMeasurementSessionSheetCards({
  session,
  activeSheetId,
  onSelectSheet
}: KioskPartMeasurementSessionSheetCardsProps) {
  const ordered = [...session.sheets].sort(
    (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
  );

  return (
    <section aria-label="同一測定の記録表一覧" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          記録表 {ordered.length} 枚
          {session.completedAt ? (
            <span className="ml-2 font-semibold text-emerald-300">（セッション完了）</span>
          ) : null}
        </span>
      </div>
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {ordered.map((sh) => {
          const title = sh.templateName?.trim() || 'テンプレ未設定';
          const selected = sh.id === activeSheetId;
          return (
            <button
              key={sh.id}
              type="button"
              onClick={() => onSelectSheet(sh.id)}
              className={clsx(
                'min-w-[10.5rem] max-w-[16rem] shrink-0 rounded-lg border p-2 text-left text-xs shadow-sm outline-none transition-colors',
                selected
                  ? 'border-blue-400 bg-slate-800 ring-2 ring-blue-400/80'
                  : 'border-white/15 bg-slate-900/80 hover:border-white/30 hover:bg-slate-800/90'
              )}
            >
              <p className="line-clamp-2 font-semibold leading-snug text-white">{title}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                <span className="font-medium text-slate-300">{statusLabel(sh.status)}</span>
                {' · '}
                更新 {formatKioskPartMeasurementDraftUpdatedAt(sh.updatedAt)}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
