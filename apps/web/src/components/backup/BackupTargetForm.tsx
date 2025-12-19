import { useState, useEffect } from 'react';

import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

import type { BackupTarget } from '../../api/backup';

interface BackupTargetFormProps {
  initialValues?: BackupTarget;
  onSubmit: (target: Omit<BackupTarget, 'enabled'> & { enabled?: boolean }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function BackupTargetForm({ initialValues, onSubmit, onCancel, isLoading }: BackupTargetFormProps) {
  const [kind, setKind] = useState<BackupTarget['kind']>(initialValues?.kind || 'database');
  const [source, setSource] = useState(initialValues?.source || '');
  const [schedule, setSchedule] = useState(initialValues?.schedule || '');
  const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);
  const kindId = 'backup-target-kind';
  const sourceId = 'backup-target-source';
  const scheduleId = 'backup-target-schedule';

  useEffect(() => {
    if (initialValues) {
      setKind(initialValues.kind);
      setSource(initialValues.source);
      setSchedule(initialValues.schedule || '');
      setEnabled(initialValues.enabled);
    }
  }, [initialValues]);

  const getSourcePlaceholder = () => {
    switch (kind) {
      case 'database':
        return 'postgresql://postgres:postgres@db:5432/borrow_return';
      case 'csv':
        return 'employees または items';
      case 'image':
        return 'photo-storage';
      case 'file':
        return '/path/to/file.txt';
      case 'directory':
        return '/path/to/directory';
      default:
        return '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim()) {
      alert('ソースを入力してください');
      return;
    }
    onSubmit({
      kind,
      source: source.trim(),
      schedule: schedule.trim() || undefined,
      enabled
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={kindId} className="block text-sm font-semibold text-slate-700 mb-1">
          種類 <span className="text-red-600">*</span>
        </label>
        <select
          id={kindId}
          name="kind"
          className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
          value={kind}
          onChange={(e) => setKind(e.target.value as BackupTarget['kind'])}
          disabled={isLoading || !!initialValues}
        >
          <option value="database">データベース</option>
          <option value="csv">CSV</option>
          <option value="image">画像</option>
          <option value="file">ファイル</option>
          <option value="directory">ディレクトリ</option>
        </select>
      </div>

      <div>
        <label htmlFor={sourceId} className="block text-sm font-semibold text-slate-700 mb-1">
          ソース <span className="text-red-600">*</span>
        </label>
        <Input
          id={sourceId}
          name="source"
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={getSourcePlaceholder()}
          disabled={isLoading}
          required
        />
        <p className="mt-1 text-xs text-slate-600">
          {kind === 'database' && 'PostgreSQL接続文字列'}
          {kind === 'csv' && 'employees または items'}
          {kind === 'image' && 'photo-storage（固定値）'}
          {kind === 'file' && 'バックアップ対象のファイルパス'}
          {kind === 'directory' && 'バックアップ対象のディレクトリパス'}
        </p>
      </div>

      <div>
        <label htmlFor={scheduleId} className="block text-sm font-semibold text-slate-700 mb-1">
          スケジュール（cron形式）
        </label>
        <Input
          id={scheduleId}
          name="schedule"
          type="text"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="0 4 * * *"
          disabled={isLoading}
        />
        <p className="mt-1 text-xs text-slate-600">
          例: 0 4 * * *（毎日4時）、0 */6 * * *（6時間ごと）
        </p>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={isLoading}
            className="rounded border-2 border-slate-500"
          />
          有効にする
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isLoading || !source.trim()}>
          {isLoading ? '保存中...' : '保存'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isLoading}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
