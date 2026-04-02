import clsx from 'clsx';

import { formatDueDate } from '../productionSchedule/formatDueDate';
import { formatPlannedDateLabel, formatPlannedQuantityLabel } from '../productionSchedule/plannedDueDisplay';

import type { ProductionScheduleDueManagementPartItem, ProductionScheduleDueManagementSeibanDetail } from '../../../api/client';

type Props = {
  isOpen: boolean;
  selectedFseiban: string | null;
  detail: ProductionScheduleDueManagementSeibanDetail | undefined;
  loading: boolean;
  error: boolean;
  dueUpdatePending: boolean;
  onClose: () => void;
  onOpenSeibanDueDatePicker: () => void;
  onOpenProcessingDueDatePicker: (processingType: string, dueDate: string | null) => void;
};

function PartRow({ part }: { part: ProductionScheduleDueManagementPartItem }) {
  return (
    <tr className="border-b border-white/10">
      <td className="px-2 py-2 font-mono">{part.fhincd || '-'}</td>
      <td className="px-2 py-2 font-mono">{part.productNo || '-'}</td>
      <td className="px-2 py-2">{part.fhinmei || '-'}</td>
      <td className="px-2 py-2">{part.processingType || '-'}</td>
      <td className="px-2 py-2">{formatPlannedQuantityLabel(part.plannedQuantity ?? null)}</td>
      <td className="px-2 py-2">{formatPlannedDateLabel(part.plannedStartDate ?? null)}</td>
      <td className={clsx('px-2 py-2', part.effectiveDueDateSource === 'manual' ? 'font-semibold text-amber-200' : 'text-white/90')}>
        {formatDueDate(part.effectiveDueDate ?? null)}
      </td>
    </tr>
  );
}

export function LeaderBoardDueAssistPanel({
  isOpen,
  selectedFseiban,
  detail,
  loading,
  error,
  dueUpdatePending,
  onClose,
  onOpenSeibanDueDatePicker,
  onOpenProcessingDueDatePicker
}: Props) {
  return (
    <aside
      className={clsx(
        'fixed top-0 right-0 z-[70] flex h-full w-[min(52rem,92vw)] flex-col border-l border-white/15 bg-slate-900/95 shadow-2xl backdrop-blur-md transition-transform duration-200 ease-out',
        isOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'
      )}
      aria-hidden={!isOpen}
      aria-label="製番納期アシスト"
    >
      <header className="flex items-center justify-between border-b border-white/15 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">製番納期アシスト</h2>
          <p className="text-xs text-white/60">
            対象製番: <span className="font-mono text-white/90">{selectedFseiban ?? '未選択'}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-white/20 px-2 py-1 text-xs text-white/90 hover:bg-white/10"
        >
          閉じる
        </button>
      </header>

      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSeibanDueDatePicker}
            disabled={!detail?.fseiban || dueUpdatePending}
            className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-60"
          >
            納期日: {formatDueDate(detail?.dueDate ?? null)}
          </button>
          {(detail?.processingTypeDueDates ?? []).map((item) => (
            <button
              key={item.processingType}
              type="button"
              onClick={() => onOpenProcessingDueDatePicker(item.processingType, item.dueDate)}
              className="rounded-md bg-cyan-700 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-600 disabled:opacity-60"
              disabled={!detail?.fseiban || dueUpdatePending}
            >
              {item.processingType}: {formatDueDate(item.dueDate)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? <p className="text-sm text-white/70">製番詳細を読み込み中...</p> : null}
        {error ? <p className="text-sm text-rose-300">製番詳細の取得に失敗しました。</p> : null}
        {!loading && !error && !detail ? (
          <p className="text-sm text-white/70">左パネルで製番を検索または履歴から選択してください。</p>
        ) : null}
        {!loading && !error && detail && detail.parts.length === 0 ? (
          <p className="text-sm text-white/70">部品一覧がありません。</p>
        ) : null}
        {!loading && !error && detail && detail.parts.length > 0 ? (
          <table className="w-full border-collapse text-left text-xs text-white">
            <thead className="sticky top-0 z-10 bg-slate-900/95">
              <tr className="border-b border-white/20 text-white/80">
                <th className="px-2 py-2">部品</th>
                <th className="px-2 py-2">製造order番号</th>
                <th className="px-2 py-2">品名</th>
                <th className="px-2 py-2">処理</th>
                <th className="px-2 py-2">指示数</th>
                <th className="px-2 py-2">着手日</th>
                <th className="px-2 py-2">納期</th>
              </tr>
            </thead>
            <tbody>
              {detail.parts.map((part, index) => (
                <PartRow key={`${part.fhincd}\0${part.productNo}\0${index}`} part={part} />
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </aside>
  );
}
