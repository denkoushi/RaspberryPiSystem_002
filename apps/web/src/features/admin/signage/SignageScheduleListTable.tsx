import { Button } from '../../../components/ui/Button';
import { formatSignageTargetSummary } from '../../../lib/signageTargetClientDevices';

import { DAYS_OF_WEEK } from './signageScheduleDisplay';

import type { SignageScheduleEditorController } from './useSignageScheduleEditor';
import type { SignageSchedule } from '../../../api/client';

type SignageScheduleListTableProps = {
  schedules: SignageSchedule[] | undefined;
  clientsByApiKey: SignageScheduleEditorController['clientsForSignageQuery']['clientsByApiKey'];
  onEdit: (schedule: SignageSchedule) => void;
  onDelete: (id: string) => void;
  isError: boolean;
  isLoading: boolean;
};

export function SignageScheduleListTable({
  schedules,
  clientsByApiKey,
  onEdit,
  onDelete,
  isError,
  isLoading,
}: SignageScheduleListTableProps) {
  if (isError) {
    return <p className="text-red-400">スケジュール一覧の取得に失敗しました</p>;
  }

  if (isLoading) {
    return <p className="text-sm font-semibold text-slate-700">読み込み中...</p>;
  }

  if (!schedules || schedules.length === 0) {
    return <p className="text-sm font-semibold text-slate-700">スケジュールが登録されていません。</p>;
  }

  return (
    <div className="space-y-4">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-500 bg-slate-100">
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">名前</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">対象端末</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">コンテンツタイプ</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">曜日</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">時間帯</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">優先順位</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">状態</th>
            <th className="px-4 py-2 text-left text-sm font-semibold text-slate-900">操作</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((schedule: SignageSchedule) => (
            <tr key={schedule.id} className="border-b border-slate-500">
              <td className="px-4 py-2 text-sm text-slate-700">{schedule.name}</td>
              <td className="px-4 py-2 text-sm text-slate-700">
                {formatSignageTargetSummary(schedule.targetClientKeys, clientsByApiKey)}
              </td>
              <td className="px-4 py-2 text-sm text-slate-700">
                {schedule.contentType === 'TOOLS' && '工具管理データ'}
                {schedule.contentType === 'PDF' && 'PDF'}
                {schedule.contentType === 'SPLIT' && '分割表示'}
              </td>
              <td className="px-4 py-2 text-sm text-slate-700">
                {schedule.dayOfWeek.map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label).join(', ')}
              </td>
              <td className="px-4 py-2 text-sm text-slate-700">
                {schedule.startTime} - {schedule.endTime}
              </td>
              <td className="px-4 py-2 text-sm text-slate-700">{schedule.priority}</td>
              <td className="px-4 py-2 text-sm text-slate-700">{schedule.enabled ? '有効' : '無効'}</td>
              <td className="px-4 py-2">
                <div className="flex gap-2">
                  <Button onClick={() => onEdit(schedule)} className="px-3 py-1 text-sm">
                    編集
                  </Button>
                  <Button
                    onClick={() => onDelete(schedule.id)}
                    variant="ghost"
                    className="px-3 py-1 text-sm font-semibold text-red-600"
                  >
                    削除
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
