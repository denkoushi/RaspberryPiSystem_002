import { FormEvent, useState } from 'react';

import {
  useInspectionItems,
  useInspectionItemMutations,
  useMeasuringInstrument
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { InspectionItem } from '../../api/types';

export function InspectionItemsPage() {
  const [instrumentId, setInstrumentId] = useState('');
  const [editingItem, setEditingItem] = useState<InspectionItem | null>(null);
  const [form, setForm] = useState({
    name: '',
    content: '',
    criteria: '',
    method: '',
    order: 0
  });

  const { data: instrument } = useMeasuringInstrument(instrumentId || undefined);
  const { data: items } = useInspectionItems(instrumentId || undefined);
  const mutations = useInspectionItemMutations(instrumentId || '');

  const startEdit = (item: InspectionItem) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      content: item.content,
      criteria: item.criteria,
      method: item.method,
      order: item.order
    });
  };

  const resetForm = () => {
    setEditingItem(null);
    setForm({ name: '', content: '', criteria: '', method: '', order: 0 });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!instrumentId) return;

    if (editingItem) {
      await mutations.update.mutateAsync({
        id: editingItem.id,
        payload: {
          name: form.name,
          content: form.content,
          criteria: form.criteria,
          method: form.method,
          order: form.order
        }
      });
    } else {
      await mutations.create.mutateAsync({
        name: form.name,
        content: form.content,
        criteria: form.criteria,
        method: form.method,
        order: form.order
      });
    }
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('この点検項目を削除しますか？')) {
      await mutations.remove.mutateAsync(id);
      if (editingItem?.id === id) {
        resetForm();
      }
    }
  };

  return (
    <div className="space-y-6">
      <Card title="計測機器選択">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            計測機器ID
            <Input
              value={instrumentId}
              onChange={(e) => {
                setInstrumentId(e.target.value);
                resetForm();
              }}
              placeholder="UUIDを入力"
            />
          </label>
          <div className="flex items-end">
            {instrument ? (
              <p className="text-sm font-semibold text-slate-700">
                {instrument.name} ({instrument.managementNumber})
              </p>
            ) : (
              <p className="text-sm text-slate-600">計測機器を選択してください</p>
            )}
          </div>
        </div>
      </Card>

      <Card title="点検項目 登録 / 編集">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            項目名
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            順序（order）
            <Input
              type="number"
              value={form.order}
              onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
              required
            />
          </label>
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            内容
            <Input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            基準
            <Input value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            方法
            <Input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} required />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={!instrumentId || !mutations || mutations.create.isPending || mutations.update.isPending}>
              {editingItem ? (mutations?.update.isPending ? '更新中…' : '上書き保存') : mutations?.create.isPending ? '送信中…' : '登録'}
            </Button>
            {editingItem ? (
              <Button type="button" variant="ghost" className="ml-3" onClick={resetForm}>
                編集キャンセル
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card title="点検項目一覧">
        {!instrumentId ? (
          <p className="text-sm text-slate-600">計測機器IDを入力してください。</p>
        ) : !items ? (
          <p className="text-sm font-semibold text-slate-700">読み込み中…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-200 text-left">
                <tr>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">順序</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">項目名</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">内容</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">基準</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">方法</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-400">
                    <td className="px-2 py-1 text-sm text-slate-700">{item.order}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{item.name}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{item.content}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{item.criteria}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{item.method}</td>
                    <td className="px-2 py-1 space-x-2">
                      <Button className="px-2 py-1 text-xs" variant="secondary" onClick={() => startEdit(item)}>
                        編集
                      </Button>
                      <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => handleDelete(item.id)}>
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
