import { FormEvent, useEffect, useState } from 'react';

import { useMeasuringInstruments, useMeasuringInstrumentMutations } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { MeasuringInstrument, MeasuringInstrumentStatus } from '../../api/types';

const statusOptions: MeasuringInstrumentStatus[] = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED'];

const initialForm = {
  name: '',
  managementNumber: '',
  storageLocation: '',
  measurementRange: '',
  calibrationExpiryDate: '',
  status: 'AVAILABLE' as MeasuringInstrumentStatus
};

export function MeasuringInstrumentsPage() {
  const { data, isLoading } = useMeasuringInstruments();
  const { create, update, remove } = useMeasuringInstrumentMutations();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (editingId) return;
    setForm((prev) => ({ ...prev, status: prev.status ?? 'AVAILABLE' }));
  }, [editingId]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      name: form.name,
      managementNumber: form.managementNumber,
      storageLocation: form.storageLocation || undefined,
      measurementRange: form.measurementRange || undefined,
      calibrationExpiryDate: form.calibrationExpiryDate ? new Date(form.calibrationExpiryDate).toISOString() : undefined,
      status: form.status
    };
    if (editingId) {
      await update.mutateAsync({ id: editingId, payload });
    } else {
      await create.mutateAsync(payload);
    }
    setForm(initialForm);
    setEditingId(null);
  };

  const startEdit = (instrument: MeasuringInstrument) => {
    setEditingId(instrument.id);
    setForm({
      name: instrument.name,
      managementNumber: instrument.managementNumber,
      storageLocation: instrument.storageLocation ?? '',
      measurementRange: instrument.measurementRange ?? '',
      calibrationExpiryDate: instrument.calibrationExpiryDate
        ? instrument.calibrationExpiryDate.slice(0, 10)
        : '',
      status: instrument.status
    });
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('この計測機器を削除しますか？')) {
      await remove.mutateAsync(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(initialForm);
      }
    }
  };

  return (
    <div className="space-y-6">
      <Card title="計測機器 登録 / 編集">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-white/70">
            名称
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="text-sm text-white/70">
            管理番号
            <Input
              value={form.managementNumber}
              onChange={(e) => setForm({ ...form, managementNumber: e.target.value })}
              required
            />
          </label>
          <label className="text-sm text-white/70">
            保管場所
            <Input
              value={form.storageLocation}
              onChange={(e) => setForm({ ...form, storageLocation: e.target.value })}
              placeholder="例: 棚A-1"
            />
          </label>
          <label className="text-sm text-white/70">
            測定範囲
            <Input
              value={form.measurementRange}
              onChange={(e) => setForm({ ...form, measurementRange: e.target.value })}
              placeholder="例: 0〜10V"
            />
          </label>
          <label className="text-sm text-white/70">
            校正期限
            <Input
              type="date"
              value={form.calibrationExpiryDate}
              onChange={(e) => setForm({ ...form, calibrationExpiryDate: e.target.value })}
            />
          </label>
          <label className="text-sm text-white/70">
            ステータス
            <select
              className="mt-1 w-full rounded-md bg-gray-800 px-3 py-2 text-white"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as MeasuringInstrumentStatus })}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {editingId ? (update.isPending ? '更新中…' : '上書き保存') : create.isPending ? '送信中…' : '登録'}
            </Button>
            {editingId ? (
              <Button
                type="button"
                variant="ghost"
                className="ml-3"
                onClick={() => {
                  setEditingId(null);
                  setForm(initialForm);
                }}
              >
                編集キャンセル
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card title="計測機器一覧">
        {isLoading ? (
          <p className="text-white/70">読み込み中…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white">
              <thead className="text-left text-white/70">
                <tr>
                  <th className="px-2 py-1">名称</th>
                  <th className="px-2 py-1">管理番号</th>
                  <th className="px-2 py-1">保管場所</th>
                  <th className="px-2 py-1">測定範囲</th>
                  <th className="px-2 py-1">校正期限</th>
                  <th className="px-2 py-1">ステータス</th>
                  <th className="px-2 py-1">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((instrument) => (
                  <tr key={instrument.id} className="border-t border-white/10">
                    <td className="px-2 py-1">{instrument.name}</td>
                    <td className="px-2 py-1">{instrument.managementNumber}</td>
                    <td className="px-2 py-1">{instrument.storageLocation ?? '-'}</td>
                    <td className="px-2 py-1">{instrument.measurementRange ?? '-'}</td>
                    <td className="px-2 py-1">
                      {instrument.calibrationExpiryDate
                        ? instrument.calibrationExpiryDate.slice(0, 10)
                        : '-'}
                    </td>
                    <td className="px-2 py-1">{instrument.status}</td>
                    <td className="px-2 py-1 space-x-2">
                      <Button className="px-2 py-1 text-xs" variant="secondary" onClick={() => startEdit(instrument)}>
                        編集
                      </Button>
                      <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => handleDelete(instrument.id)}>
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
