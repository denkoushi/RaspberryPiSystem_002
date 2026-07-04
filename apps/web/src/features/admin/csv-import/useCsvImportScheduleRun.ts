import { useRef, useState } from 'react';

import { useCsvImportScheduleMutations } from '../../../api/hooks';

import type { CsvImportSchedule } from '../../../api/backup';

type UseCsvImportScheduleRunOptions = {
  schedules: CsvImportSchedule[];
  refetch: () => void;
};

export function useCsvImportScheduleRun({ schedules, refetch }: UseCsvImportScheduleRunOptions) {
  const { run } = useCsvImportScheduleMutations();
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
  const runningScheduleIdRef = useRef<string | null>(null);
  const [runError, setRunError] = useState<Record<string, Error | null>>({});
  const [runMessage, setRunMessage] = useState<Record<string, string>>({});

  const handleRun = async (id: string) => {
    if (runningScheduleIdRef.current !== null) {
      return;
    }

    const schedule = schedules.find((s) => s.id === id);
    const scheduleName = schedule?.name || schedule?.id || 'このスケジュール';
    const provider = schedule?.provider ? schedule.provider.toUpperCase() : 'デフォルト';
    const paths = schedule?.targets && schedule.targets.length > 0
      ? schedule.targets.map(t => `${t.type}: ${t.source}`).join('\n')
      : [
          schedule?.employeesPath && `従業員: ${schedule.employeesPath}`,
          schedule?.itemsPath && `アイテム: ${schedule.itemsPath}`
        ]
          .filter(Boolean)
          .join('\n');

    if (
      !confirm(
        `以下のスケジュールを手動実行しますか？\n\nID: ${schedule?.id}\n名前: ${scheduleName}\nプロバイダー: ${provider}\n${paths ? `\n${paths}` : ''}\n\nこの操作は即座に実行されます。`
      )
    ) {
      return;
    }

    runningScheduleIdRef.current = id;
    setRunningScheduleId(id);
    setRunError(prev => ({ ...prev, [id]: null }));
    setRunMessage(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const response = await run.mutateAsync(id);
      const acceptedInBackground = response.accepted === true && response.mode === 'background';

      const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
      const summary = acceptedInBackground ? undefined : response.summary;
      const dashboardSummaryRaw = isRecord(summary) ? summary.csvDashboards : undefined;
      const dashboardSummary = isRecord(dashboardSummaryRaw) ? dashboardSummaryRaw : undefined;
      const failureMessages: string[] = [];
      if (dashboardSummary && typeof dashboardSummary === 'object') {
        for (const [dashboardId, result] of Object.entries(dashboardSummary)) {
          const debugRaw = isRecord(result) ? result.debug : undefined;
          const debug = isRecord(debugRaw) ? debugRaw : undefined;
          const failed = Array.isArray(debug?.failedMessageIdSuffixes)
            ? debug.failedMessageIdSuffixes.length
            : 0;
          if (failed <= 0) continue;
          const downloaded = Array.isArray(debug?.downloadedMessageIdSuffixes)
            ? debug.downloadedMessageIdSuffixes.length
            : 0;
          const ppErrRaw = debug?.postProcessErrorByMessageIdSuffix;
          const ppErr = isRecord(ppErrRaw) ? ppErrRaw : undefined;
          const firstFromPostProcess =
            ppErr &&
            Object.values(ppErr).find(
              (v): v is { error: string } =>
                isRecord(v) && typeof (v as { error?: unknown }).error === 'string'
            );
          const firstErrorLegacy =
            Array.isArray(debug?.errorDetails) &&
            debug.errorDetails.length > 0 &&
            isRecord(debug.errorDetails[0]) &&
            typeof debug.errorDetails[0].error === 'string'
              ? debug.errorDetails[0].error
              : undefined;
          const firstError = firstFromPostProcess?.error ?? firstErrorLegacy;
          const reason = firstError ? firstError : '不明なエラー';
          failureMessages.push(`- CSVダッシュボード(${dashboardId}): ${reason}（失敗 ${failed}/${downloaded || '?'}）`);
        }
      }
      if (failureMessages.length > 0) {
        alert(
          `一部の取り込みに失敗しました。\n\n${failureMessages.join('\n')}\n\n安全のため、該当メールは未読のまま残しています（受信箱が空になりません）。CSV列定義（例: day列）を確認して再実行してください。`
        );
      }
      setRunMessage(prev => ({
        ...prev,
        [id]: acceptedInBackground ? '実行を開始しました。完了はインポート履歴で確認してください。' : '実行しました'
      }));
      setTimeout(() => {
        setRunMessage(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, acceptedInBackground ? 8000 : 3000);

      refetch();
    } catch (error) {
      const err = error as {
        message?: string;
        response?: { status?: number; data?: { message?: unknown; errorCode?: unknown } | unknown };
      };
      setRunError(prev => ({ ...prev, [id]: err as Error }));
    } finally {
      runningScheduleIdRef.current = null;
      setRunningScheduleId(null);
    }
  };

  return {
    runningScheduleId,
    runningScheduleIdRef,
    runError,
    runMessage,
    handleRun
  };
}

export type CsvImportScheduleRunController = ReturnType<typeof useCsvImportScheduleRun>;
