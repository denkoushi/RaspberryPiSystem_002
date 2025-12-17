import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  useMeasuringInstruments,
  useMeasuringInstrumentMutations,
  useInstrumentTags
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { MeasuringInstrument, MeasuringInstrumentStatus } from '../../api/types';

const statusOptions: MeasuringInstrumentStatus[] = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED'];

const initialForm = {
  name: '',
  managementNumber: '',
  storageLocation: '',
  measurementRange: '',
  calibrationExpiryDate: '',
  status: 'AVAILABLE' as MeasuringInstrumentStatus,
  rfidTagUid: ''
};

export function MeasuringInstrumentsPage() {
  const { data, isLoading } = useMeasuringInstruments();
  const { create, update, remove } = useMeasuringInstrumentMutations();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { data: editingTags } = useInstrumentTags(editingId || undefined);
  const location = useLocation();
  const isActiveRoute = location.pathname.endsWith('/measuring-instruments');
  const nfcEvent = useNfcStream(isActiveRoute);

  useEffect(() => {
    if (editingId) return;
    setForm((prev) => ({ ...prev, status: prev.status ?? 'AVAILABLE' }));
  }, [editingId]);

  useEffect(() => {
    if (!editingId || !editingTags) return;
    const existingTagUid = editingTags[0]?.rfidTagUid ?? '';
    setForm((prev) => (prev.rfidTagUid ? prev : { ...prev, rfidTagUid: existingTagUid }));
  }, [editingId, editingTags]);

  // NFCスキャンでUID自動入力（このページがアクティブな場合のみ）
  useEffect(() => {
    if (nfcEvent?.uid) {
      setForm((prev) => ({ ...prev, rfidTagUid: nfcEvent.uid }));
    }
  }, [nfcEvent]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const rawTag = form.rfidTagUid ?? '';
    const normalizedTagUid = rawTag.trim();
    const payload = {
      name: form.name,
      managementNumber: form.managementNumber,
      storageLocation: form.storageLocation || undefined,
      measurementRange: form.measurementRange || undefined,
      calibrationExpiryDate: form.calibrationExpiryDate ? new Date(form.calibrationExpiryDate).toISOString() : undefined,
      status: form.status,
      // 空文字は削除、非空はtrim、未入力は無変更
      rfidTagUid: rawTag === '' ? '' : normalizedTagUid || undefined
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
      status: instrument.status,
      rfidTagUid: ''
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
          <label className="text-sm font-semibold text-slate-200">
            名称
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-200 md:col-span-2">
            NFC / RFIDタグUID
            <Input
              value={form.rfidTagUid}
              onChange={(e) => setForm({ ...form, rfidTagUid: e.target.value })}
              placeholder="例: 04A1B2C3D4"
            />
          </label>
          <label className="text-sm font-semibold text-slate-200">
            管理番号
            <Input
              value={form.managementNumber}
              onChange={(e) => setForm({ ...form, managementNumber: e.target.value })}
              required
            />
          </label>
          <label className="text-sm font-semibold text-slate-200">
            保管場所
            <Input
              value={form.storageLocation}
              onChange={(e) => setForm({ ...form, storageLocation: e.target.value })}
              placeholder="例: 棚A-1"
            />
          </label>
          <label className="text-sm font-semibold text-slate-200">
            測定範囲
            <Input
              value={form.measurementRange}
              onChange={(e) => setForm({ ...form, measurementRange: e.target.value })}
              placeholder="例: 0〜10V"
            />
          </label>
          <label className="text-sm font-semibold text-slate-200">
            校正期限
            <Input
              type="date"
              value={form.calibrationExpiryDate}
              onChange={(e) => setForm({ ...form, calibrationExpiryDate: e.target.value })}
            />
          </label>
          <label className="text-sm font-semibold text-slate-200">
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
          <p className="text-sm text-slate-200">読み込み中…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white">
              <thead className="text-left text-slate-200">
                <tr>
                  <th className="px-2 py-1 text-sm font-semibold">名称</th>
                  <th className="px-2 py-1 text-sm font-semibold">管理番号</th>
                  <th className="px-2 py-1 text-sm font-semibold">保管場所</th>
                  <th className="px-2 py-1 text-sm font-semibold">測定範囲</th>
                  <th className="px-2 py-1 text-sm font-semibold">校正期限</th>
                  <th className="px-2 py-1 text-sm font-semibold">ステータス</th>
                  <th className="px-2 py-1 text-sm font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((instrument) => (
                  <tr key={instrument.id} className="border-t border-white/10">
                    <td className="px-2 py-1 font-bold text-base text-white">{instrument.name}</td>
                    <td className="px-2 py-1 font-mono text-sm font-semibold">{instrument.managementNumber}</td>
                    <td className="px-2 py-1 text-sm text-slate-200">{instrument.storageLocation ?? '-'}</td>
                    <td className="px-2 py-1 text-sm text-slate-200">{instrument.measurementRange ?? '-'}</td>
                    <td className="px-2 py-1 text-sm text-slate-200">
                      {instrument.calibrationExpiryDate
                        ? instrument.calibrationExpiryDate.slice(0, 10)
                        : '-'}
                    </td>
                    <td className="px-2 py-1 text-sm text-slate-200">{instrument.status}</td>
                    <td className="px-2 py-1 space-x-2">
                      <Button className="px-2 py-1 text-sm" variant="secondary" onClick={() => startEdit(instrument)}>
                        編集
                      </Button>
                      <Button className="px-2 py-1 text-sm" variant="ghost" onClick={() => handleDelete(instrument.id)}>
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
