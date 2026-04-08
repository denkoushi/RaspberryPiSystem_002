import { useMemo } from 'react';

import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';

import {
  formatKioskGmailIngestCronExpression,
  formatKioskGmailIngestEnabledLabel,
  normalizeKioskGmailIngestSchedules,
} from './kioskGmailIngestScheduleDisplay';

import type { KioskDocumentGmailIngestSchedule } from '../../../api/backup';

export interface KioskGmailIngestScheduleListSectionProps {
  /** 取得成功後の一覧（loading 中は undefined でも可） */
  schedulesRaw: KioskDocumentGmailIngestSchedule[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onUseScheduleId: (scheduleId: string) => void;
}

/**
 * 要領書 Gmail 取り込みスケジュールの読み取り専用一覧（csvImports とは別設定）
 */
export function KioskGmailIngestScheduleListSection({
  schedulesRaw,
  isLoading,
  isError,
  onUseScheduleId,
}: KioskGmailIngestScheduleListSectionProps) {
  const schedules = useMemo(() => normalizeKioskGmailIngestSchedules(schedulesRaw), [schedulesRaw]);

  return (
    <Card title="要領書Gmailスケジュール一覧（読み取り）">
      <p className="mb-3 text-sm text-slate-600">
        <code className="rounded bg-slate-100 px-1">backup.json</code> の{' '}
        <code className="rounded bg-slate-100 px-1">kioskDocumentGmailIngest</code>{' '}
        を表示します。編集はバックアップ設定から行ってください。
      </p>
      {isLoading ? (
        <p className="text-sm text-slate-600">読み込み中…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">バックアップ設定の取得に失敗しました（API / 権限を確認してください）。</p>
      ) : schedules.length === 0 ? (
        <p className="text-sm text-slate-600">
          登録されたスケジュールはありません。<code className="rounded bg-slate-100 px-1">kioskDocumentGmailIngest</code>{' '}
          にエントリを追加するとここに表示されます。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">名前</th>
                <th className="px-3 py-2 font-semibold">件名パターン</th>
                <th className="px-3 py-2 font-semibold">送信元（任意）</th>
                <th className="px-3 py-2 font-semibold">cron</th>
                <th className="px-3 py-2 font-semibold">状態</th>
                <th className="px-3 py-2 font-semibold">手動実行</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((row) => {
                const effectiveEnabled = row.enabled ?? true;
                return (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                  <td className="px-3 py-2">{row.name?.trim() ? row.name : '—'}</td>
                  <td className="px-3 py-2">{row.subjectPattern?.trim() ? row.subjectPattern : '—'}</td>
                  <td className="px-3 py-2">{row.fromEmail?.trim() ? row.fromEmail : '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatKioskGmailIngestCronExpression(row.schedule)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        effectiveEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {formatKioskGmailIngestEnabledLabel(effectiveEnabled)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Button type="button" variant="ghost" onClick={() => onUseScheduleId(row.id)}>
                      IDを手動実行欄に反映
                    </Button>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
