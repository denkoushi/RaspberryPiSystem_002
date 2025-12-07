import { useState } from 'react';

import { useSignageSchedules, useSignageScheduleMutations, useSignagePdfs, useSignageRenderMutation, useSignageRenderStatus } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { SignageSchedule, SignagePdf } from '../../api/client';

const DAYS_OF_WEEK = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

export function SignageSchedulesPage() {
  const schedulesQuery = useSignageSchedules();
  const pdfsQuery = useSignagePdfs();
  const { create, update, remove } = useSignageScheduleMutations();
  const renderMutation = useSignageRenderMutation();
  const renderStatusQuery = useSignageRenderStatus();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<SignageSchedule>>({
    name: '',
    contentType: 'TOOLS',
    pdfId: null,
    dayOfWeek: [],
    startTime: '09:00',
    endTime: '18:00',
    priority: 0,
    enabled: true,
  });

  const handleCreate = () => {
    setIsCreating(true);
    setFormData({
      name: '',
      contentType: 'TOOLS',
      pdfId: null,
      dayOfWeek: [],
      startTime: '09:00',
      endTime: '18:00',
      priority: 0,
      enabled: true,
    });
  };

  const handleEdit = (schedule: SignageSchedule) => {
    setEditingId(schedule.id);
    setFormData({
      name: schedule.name,
      contentType: schedule.contentType,
      pdfId: schedule.pdfId,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      priority: schedule.priority,
      enabled: schedule.enabled,
    });
  };

  const handleSave = async () => {
    try {
      if (isCreating) {
        await create.mutateAsync({
          name: formData.name!,
          contentType: formData.contentType!,
          pdfId: formData.pdfId ?? null,
          dayOfWeek: formData.dayOfWeek!,
          startTime: formData.startTime!,
          endTime: formData.endTime!,
          priority: formData.priority!,
          enabled: formData.enabled ?? true,
        });
        setIsCreating(false);
      } else if (editingId) {
        await update.mutateAsync({
          id: editingId,
          payload: formData,
        });
        setEditingId(null);
      }
      setFormData({
        name: '',
        contentType: 'TOOLS',
        pdfId: null,
        dayOfWeek: [],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
        enabled: true,
      });
    } catch (error) {
      console.error('Failed to save schedule:', error);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormData({
      name: '',
      contentType: 'TOOLS',
      pdfId: null,
      dayOfWeek: [],
      startTime: '09:00',
      endTime: '18:00',
      priority: 0,
      enabled: true,
    });
  };

  const handleDelete = async (id: string) => {
    if (confirm('このスケジュールを削除しますか？')) {
      await remove.mutateAsync(id);
    }
  };

  const toggleDayOfWeek = (day: number) => {
    const currentDays = formData.dayOfWeek || [];
    if (currentDays.includes(day)) {
      setFormData({ ...formData, dayOfWeek: currentDays.filter((d) => d !== day) });
    } else {
      setFormData({ ...formData, dayOfWeek: [...currentDays, day] });
    }
  };

  const handleRender = async () => {
    try {
      await renderMutation.mutateAsync();
      alert('サイネージの再レンダリングを開始しました');
    } catch (error) {
      console.error('Failed to render signage:', error);
      alert('サイネージの再レンダリングに失敗しました');
    }
  };

  return (
    <div className="space-y-6">
      <Card
        title="スケジュール管理"
        action={
          !isCreating && !editingId ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleRender}
                disabled={renderMutation.isPending}
                variant="secondary"
              >
                {renderMutation.isPending ? 'レンダリング中...' : '再レンダリング'}
              </Button>
              {renderStatusQuery.data && (
                <span className="text-sm text-white/70">
                  （自動更新: {renderStatusQuery.data.intervalSeconds}秒間隔）
                </span>
              )}
              <Button onClick={handleCreate}>新規作成</Button>
            </div>
          ) : null
        }
      >
        {(isCreating || editingId) && (
          <div className="mb-6 space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
            <div>
              <label className="block text-sm text-white/70">スケジュール名</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-white/70">コンテンツタイプ</label>
              <select
                value={formData.contentType || 'TOOLS'}
                onChange={(e) => setFormData({ ...formData, contentType: e.target.value as 'TOOLS' | 'PDF' | 'SPLIT' })}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
              >
                <option value="TOOLS">工具管理データ</option>
                <option value="PDF">PDF</option>
                <option value="SPLIT">分割表示（工具+PDF）</option>
              </select>
            </div>
            {(formData.contentType === 'PDF' || formData.contentType === 'SPLIT') && (
              <div>
                <label className="block text-sm text-white/70">PDF</label>
                <select
                  value={formData.pdfId || ''}
                  onChange={(e) => setFormData({ ...formData, pdfId: e.target.value || null })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                >
                  <option value="">選択してください</option>
                  {pdfsQuery.data?.map((pdf: SignagePdf) => (
                    <option key={pdf.id} value={pdf.id}>
                      {pdf.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm text-white/70">曜日</label>
              <div className="mt-1 flex gap-2">
                {DAYS_OF_WEEK.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDayOfWeek(day.value)}
                    className={`rounded-md px-3 py-1 text-sm ${
                      formData.dayOfWeek?.includes(day.value)
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/70">開始時刻</label>
                <input
                  type="time"
                  value={formData.startTime || ''}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-white/70">終了時刻</label>
                <input
                  type="time"
                  value={formData.endTime || ''}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-white/70">優先順位</label>
              <input
                type="number"
                value={formData.priority || 0}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) })}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.enabled ?? true}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="rounded border-white/10"
              />
              <label className="text-sm text-white/70">有効</label>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
                保存
              </Button>
              <Button onClick={handleCancel} variant="ghost" disabled={create.isPending || update.isPending}>
                キャンセル
              </Button>
            </div>
          </div>
        )}

        {schedulesQuery.isError ? (
          <p className="text-red-400">スケジュール一覧の取得に失敗しました</p>
        ) : schedulesQuery.isLoading ? (
          <p>読み込み中...</p>
        ) : schedulesQuery.data && schedulesQuery.data.length > 0 ? (
          <div className="space-y-4">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-2 text-left">名前</th>
                  <th className="px-4 py-2 text-left">コンテンツタイプ</th>
                  <th className="px-4 py-2 text-left">曜日</th>
                  <th className="px-4 py-2 text-left">時間帯</th>
                  <th className="px-4 py-2 text-left">優先順位</th>
                  <th className="px-4 py-2 text-left">状態</th>
                  <th className="px-4 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {schedulesQuery.data.map((schedule: SignageSchedule) => (
                  <tr key={schedule.id} className="border-b border-white/5">
                    <td className="px-4 py-2">{schedule.name}</td>
                    <td className="px-4 py-2">
                      {schedule.contentType === 'TOOLS' && '工具管理データ'}
                      {schedule.contentType === 'PDF' && 'PDF'}
                      {schedule.contentType === 'SPLIT' && '分割表示'}
                    </td>
                    <td className="px-4 py-2">
                      {schedule.dayOfWeek.map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label).join(', ')}
                    </td>
                    <td className="px-4 py-2">
                      {schedule.startTime} - {schedule.endTime}
                    </td>
                    <td className="px-4 py-2">{schedule.priority}</td>
                    <td className="px-4 py-2">{schedule.enabled ? '有効' : '無効'}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <Button onClick={() => handleEdit(schedule)} className="px-3 py-1 text-sm">
                          編集
                        </Button>
                        <Button
                          onClick={() => handleDelete(schedule.id)}
                          variant="ghost"
                          className="px-3 py-1 text-sm text-red-400"
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
        ) : (
          <p>スケジュールが登録されていません。</p>
        )}
      </Card>
    </div>
  );
}

