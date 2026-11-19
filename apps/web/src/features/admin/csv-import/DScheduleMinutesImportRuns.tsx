import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getDScheduleMinutesImportRuns, reimportDScheduleMinutesOriginal } from '../../../api/backup';

import { formatCsvImportError } from './csvImportError';
import { boardButtonClassName } from './CsvImportScheduleBoard';

import type { DScheduleMinutesImportRun, DScheduleMinutesReimportResult } from '../../../api/backup';

const historyKey = ['dScheduleMinutesImportRuns'];
const reimportKey = ['dScheduleMinutesReimport'];
const dateTime = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tokyo' });

type ReimportOutcome = { result: DScheduleMinutesReimportResult } | { error: string };

function formatResult({ status, warningCounts, autoRegistrationSkipped }: DScheduleMinutesReimportResult) {
  const count = Object.values(warningCounts).reduce((total, value) => total + value, 0);
  return [
    status === 'SUCCESS' ? '成功' : status,
    `警告 ${count}件`,
    ...(autoRegistrationSkipped === 'STALE_FILE' ? ['古いファイルのため自動登録をスキップ'] : []),
  ].join('・');
}

export function DScheduleMinutesImportRuns({ isScheduleRunning }: { isScheduleRunning: boolean }) {
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: historyKey, queryFn: getDScheduleMinutesImportRuns });
  const [outcomes, setOutcomes] = useState<Record<string, ReimportOutcome>>({});
  const reimport = useMutation({
    mutationKey: reimportKey,
    mutationFn: (run: DScheduleMinutesImportRun) => reimportDScheduleMinutesOriginal(run.id),
    retry: false,
    onSuccess: (result, { id }) => {
      setOutcomes((current) => ({ ...current, [id]: { result } }));
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (error, { id }) => setOutcomes((current) => ({ ...current, [id]: { error: formatCsvImportError(error) } })),
  });
  const isReimporting = useIsMutating({ mutationKey: reimportKey }) > 0;

  if (history.isPending) return <p role="status" className="text-xs text-slate-600">読み込み中...</p>;
  if (!history.data) return <p role="alert" className="text-xs text-red-700">{formatCsvImportError(history.error)}</p>;
  const selectedRun = reimport.variables;
  // Keep the selected row's result visible if it falls outside the latest 30 runs.
  const runs = selectedRun && !history.data.some(({ id }) => id === selectedRun.id) ? [...history.data, selectedRun] : history.data;
  if (runs.length === 0) return <p className="text-xs text-slate-600">取り込み履歴はありません</p>;

  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-300">
      <table aria-label="日程会議議事録の取り込み履歴" className="w-full table-fixed text-left text-xs">
        <tbody className="divide-y divide-slate-200">
          {runs.map((run) => {
            const outcome = outcomes[run.id];
            const isPending = reimport.isPending && selectedRun?.id === run.id;
            return (
              <tr key={run.id}>
                <td className="px-2 py-2 align-top">
                  <div className="flex flex-wrap gap-x-2 text-slate-600">
                    <time dateTime={run.createdAt}>{dateTime.format(new Date(run.createdAt))}</time>
                    <span>{run.kind === 'D_COMPANY' ? 'D社' : '一般'}</span>
                  </div>
                  <div className="mt-0.5 break-all font-semibold">{run.filename}</div>
                  {!isPending && outcome && ('error' in outcome ? (
                    <div role="alert" className="mt-1 break-words text-red-700">{outcome.error}</div>
                  ) : (
                    <div role="status" className="mt-1 break-words text-emerald-700">{formatResult(outcome.result)}</div>
                  ))}
                </td>
                <td className="w-32 px-2 py-2 text-right align-top">
                  <button
                    type="button"
                    className={`${boardButtonClassName} whitespace-nowrap`}
                    disabled={isReimporting || reimport.isPending || isScheduleRunning || !run.hasOriginalFile}
                    onClick={() => reimport.mutate(run)}
                  >
                    {isPending ? '実行中' : '取り込み直す'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
