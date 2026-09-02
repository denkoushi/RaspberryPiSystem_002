import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { dedupeAndSortWorkInstructionTargets } from '../../lib/workInstructionRules';

import type { WorkInstructionPartCandidate } from '../../api/client';

type WorkInstructionPartCandidateDialogProps = {
  isOpen: boolean;
  matchedPrefix: string | null;
  candidates: readonly WorkInstructionPartCandidate[];
  offset: number;
  pageSize: number;
  hasMore: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  onSelect: (partNumber: string) => void;
  onPageChange: (offset: number) => void;
  onClose: () => void;
};

export function WorkInstructionPartCandidateDialog({
  isOpen,
  matchedPrefix,
  candidates,
  offset,
  pageSize,
  hasMore,
  isLoading,
  errorMessage,
  onSelect,
  onPageChange,
  onClose
}: WorkInstructionPartCandidateDialogProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="部品番号候補を選択"
      description={matchedPrefix ? `検索文字: ${matchedPrefix}` : '該当する部品番号を検索しています。'}
      size="lg"
      className="flex flex-col overflow-hidden"
    >
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="py-10 text-center text-slate-500">候補を検索中…</p>
        ) : errorMessage ? (
          <p className="rounded border border-rose-300 bg-rose-50 px-3 py-3 text-rose-700">{errorMessage}</p>
        ) : candidates.length === 0 ? (
          <p className="py-10 text-center text-slate-500">該当する作業要領書がありません。</p>
        ) : (
          <div className="space-y-2">
            {candidates.map((candidate) => {
              const partName = candidate.partName?.trim() || '部品名未登録';
              return (
                <button
                  key={candidate.partNumber}
                  type="button"
                  className="flex min-h-16 w-full items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 text-left hover:border-cyan-500 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  aria-label={`${candidate.partNumber} ${partName}を選択`}
                  onClick={() => onSelect(candidate.partNumber)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-slate-900">{candidate.partNumber}</span>
                    <span className="block truncate text-sm text-slate-600">{partName}</span>
                  </span>
                  <span className="flex max-w-[45%] flex-wrap justify-end gap-1">
                    {dedupeAndSortWorkInstructionTargets(candidate.shootingTargets).map((target) => (
                      <span
                        key={target}
                        className="rounded-full border border-cyan-300 bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-900"
                      >
                        {target}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <span className="text-sm text-slate-500">
          {candidates.length > 0 ? `${Math.floor(offset / pageSize) + 1} ページ目` : ''}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={offset === 0 || isLoading}
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
          >
            前のページ
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!hasMore || isLoading}
            onClick={() => onPageChange(offset + pageSize)}
          >
            次のページ
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </Dialog>
  );
}
