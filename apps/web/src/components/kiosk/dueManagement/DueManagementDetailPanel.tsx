import { formatDueDate } from '../../../features/kiosk/productionSchedule/formatDueDate';

import type { ProductionScheduleDueManagementPartItem } from '../../../api/client';

type DueManagementDetailPanelProps = {
  detailLoading: boolean;
  detailError: boolean;
  selectedFseiban: string | null;
  fseiban: string | null;
  dueDate: string | null;
  orderedParts: ProductionScheduleDueManagementPartItem[];
  processingTypeOptions: Array<{ code: string; label: string; enabled: boolean }>;
  updatePartProcessingPending: boolean;
  updatePartPrioritiesPending: boolean;
  updatePartNotePending: boolean;
  onOpenDatePicker: () => void;
  onSavePartPriorities: () => void;
  onSaveProcessingType: (fhincd: string, processingType: string) => void;
  onOpenPartNoteModal: (fhincd: string, note: string | null) => void;
  onMovePart: (index: number, direction: -1 | 1) => void;
};

export function DueManagementDetailPanel(props: DueManagementDetailPanelProps) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-white/20 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">部品優先順位（製番単位）</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onOpenDatePicker}
            className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600"
            disabled={!props.fseiban}
          >
            納期日: {formatDueDate(props.dueDate)}
          </button>
          <button
            type="button"
            onClick={props.onSavePartPriorities}
            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            disabled={!props.selectedFseiban || props.updatePartPrioritiesPending}
          >
            {props.updatePartPrioritiesPending ? '保存中...' : '優先順位を保存'}
          </button>
        </div>
      </header>
      <div className="h-[calc(100%-52px)] overflow-auto p-4">
        {props.detailLoading ? <p className="text-sm text-white/80">読み込み中...</p> : null}
        {props.detailError ? <p className="text-sm text-rose-300">詳細取得に失敗しました。</p> : null}
        {!props.detailLoading && props.orderedParts.length === 0 ? (
          <p className="text-sm text-white/80">製番を選択してください。</p>
        ) : null}
        {props.orderedParts.length > 0 ? (
          <table className="w-full border-collapse text-left text-xs text-white">
            <thead className="sticky top-0 z-10 bg-slate-900/95">
              <tr className="border-b border-white/20 text-white/80">
                <th className="px-2 py-2">順位</th>
                <th className="px-2 py-2">部品</th>
                <th className="px-2 py-2">製造order番号</th>
                <th className="px-2 py-2">品名</th>
                <th className="px-2 py-2">処理</th>
                <th className="px-2 py-2">工程数</th>
                <th className="px-2 py-2">工程進捗</th>
                <th className="px-2 py-2">所要(min)</th>
                <th className="px-2 py-2">実績基準時間(分/個)</th>
                <th className="px-2 py-2">備考</th>
                <th className="px-2 py-2">提案順位</th>
                <th className="px-2 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.orderedParts.map((part, index) => (
                <tr key={part.fhincd} className="border-b border-white/10">
                  <td className="px-2 py-2">{index + 1}</td>
                  <td className="px-2 py-2 font-mono">{part.fhincd}</td>
                  <td className="px-2 py-2 font-mono">{part.productNo || '-'}</td>
                  <td className="px-2 py-2">{part.fhinmei || '-'}</td>
                  <td className="px-2 py-2">
                    <select
                      value={part.processingType ?? ''}
                      onChange={(event) => props.onSaveProcessingType(part.fhincd, event.target.value)}
                      className="h-8 w-24 rounded border border-slate-300 bg-white px-2 text-xs text-black"
                      disabled={props.updatePartProcessingPending}
                    >
                      <option value="">-</option>
                      {props.processingTypeOptions
                        .filter((option) => option.enabled)
                        .map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">{part.processCount}</td>
                  <td className="px-2 py-2">
                    <div className="mb-1 text-[10px] text-white/80">
                      {part.completedProcessCount}/{part.totalProcessCount}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {part.processes.map((process) => {
                        const resourceNames = process.resourceNames ?? [];
                        const tooltip = resourceNames.length > 0 ? resourceNames.join('\n') : undefined;
                        const ariaLabel =
                          resourceNames.length > 0
                            ? `${process.resourceCd}: ${resourceNames.join(' / ')}`
                            : process.resourceCd;
                        return (
                          <span
                            key={process.rowId}
                            className={`rounded border px-2 py-1 text-[10px] ${
                              process.isCompleted
                                ? 'border-slate-400 bg-white/10 text-white/70 opacity-50 grayscale'
                                : 'border-blue-300 bg-blue-500/30 text-blue-100'
                            }`}
                            title={tooltip}
                            aria-label={ariaLabel}
                          >
                            {process.resourceCd}
                            {process.processOrder !== null ? `-${process.processOrder}` : ''}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-2 py-2">{Math.round(part.totalRequiredMinutes)}</td>
                  <td className="px-2 py-2">
                    {typeof part.actualPerPieceMinutes === 'number' ? part.actualPerPieceMinutes.toFixed(2) : '-'}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => props.onOpenPartNoteModal(part.fhincd, part.note ?? null)}
                      className="max-w-[180px] truncate rounded bg-white/10 px-2 py-1 text-left text-[11px] text-white/90 hover:bg-white/20"
                      disabled={props.updatePartNotePending}
                      title={part.note ?? ''}
                    >
                      {part.note?.trim() ? part.note : '編集'}
                    </button>
                  </td>
                  <td className="px-2 py-2">{part.suggestedPriorityRank ?? '-'}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                        onClick={() => props.onMovePart(index, -1)}
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                        onClick={() => props.onMovePart(index, 1)}
                        disabled={index === props.orderedParts.length - 1}
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}
