import axios from 'axios';
import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useItemMutations, useItems } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { Item } from '../../api/types';

const initialItem = {
  itemCode: '',
  name: '',
  category: '',
  storageLocation: '',
  nfcTagUid: ''
};

export function ItemsPage() {
  const { data, isLoading } = useItems();
  const { create, update, remove } = useItemMutations();
  const confirm = useConfirm();
  const [form, setForm] = useState(initialItem);
  const [editingId, setEditingId] = useState<string | null>(null);
  // スコープ分離: このページがアクティブな場合のみNFCを有効にする
  const location = useLocation();
  const isActiveRoute = location.pathname.endsWith('/items');
  const nfcEvent = useNfcStream(isActiveRoute);

  useEffect(() => {
    if (nfcEvent?.uid) {
      setForm((prev) => ({ ...prev, nfcTagUid: nfcEvent.uid }));
    }
  }, [nfcEvent]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (editingId) {
      await update.mutateAsync({
        id: editingId,
        payload: {
          itemCode: form.itemCode,
          name: form.name,
          category: form.category || undefined,
          storageLocation: form.storageLocation || undefined,
          nfcTagUid: form.nfcTagUid || undefined
        }
      });
    } else {
      await create.mutateAsync({
        itemCode: form.itemCode,
        name: form.name,
        category: form.category || undefined,
        storageLocation: form.storageLocation || undefined,
        nfcTagUid: form.nfcTagUid || undefined
      });
    }
    setForm(initialItem);
    setEditingId(null);
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setForm({
      itemCode: item.itemCode,
      name: item.name,
      category: item.category ?? '',
      storageLocation: item.storageLocation ?? '',
      nfcTagUid: item.nfcTagUid ?? ''
    });
  };

  const handleDelete = async (id: string) => {
    const shouldDelete = await confirm({
      title: 'このアイテムを削除しますか？',
      description: '削除すると元に戻せません。',
      confirmLabel: '削除',
      cancelLabel: 'キャンセル',
      tone: 'danger'
    });
    if (!shouldDelete) return;
    try {
      await remove.mutateAsync(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(initialItem);
      }
    } catch (error) {
      // エラーはReact Queryが自動的に処理する（remove.errorに設定される）
      console.error('Delete error:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card title="アイテム登録 / 編集">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            管理コード
            <Input value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            名称
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            NFC UID
            <Input value={form.nfcTagUid} onChange={(e) => setForm({ ...form, nfcTagUid: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            カテゴリ
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            保管場所
            <Input value={form.storageLocation} onChange={(e) => setForm({ ...form, storageLocation: e.target.value })} />
          </label>
        <div className="md:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {editingId ? (update.isPending ? '更新中…' : '上書き保存') : create.isPending ? '送信中…' : '登録'}
          </Button>
          {editingId ? (
            <Button type="button" variant="ghost" className="ml-3" onClick={() => { setEditingId(null); setForm(initialItem); }}>
              編集キャンセル
            </Button>
          ) : null}
        </div>
        </form>
      </Card>

      <Card title="アイテム一覧">
        {remove.error ? (
          <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-200">
            <p className="font-semibold">エラー</p>
            <p className="mt-1">
              {axios.isAxiosError(remove.error) && remove.error.response?.data?.message
                ? remove.error.response.data.message
                : (remove.error as Error).message || '削除に失敗しました'}
            </p>
          </div>
        ) : null}
        {isLoading ? (
          <p className="text-sm text-slate-700">読み込み中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 border-b-2 border-slate-500">
                <tr>
                  <th className="px-2 py-1 text-sm font-semibold">名称</th>
                  <th className="px-2 py-1 text-sm font-semibold">管理コード</th>
                  <th className="px-2 py-1 text-sm font-semibold">カテゴリ</th>
                  <th className="px-2 py-1 text-sm font-semibold">保管場所</th>
                  <th className="px-2 py-1 text-sm font-semibold">NFC UID</th>
                  <th className="px-2 py-1 text-sm font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((item) => (
                <tr key={item.id} className="border-t border-slate-500">
                  <td className="px-2 py-1 font-bold text-base text-slate-900">{item.name}</td>
                  <td className="px-2 py-1 font-mono text-sm font-semibold text-slate-900">{item.itemCode}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{item.category ?? '-'}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{item.storageLocation ?? '-'}</td>
                  <td className="px-2 py-1 font-mono text-sm text-slate-700">{item.nfcTagUid ?? '-'}</td>
                  <td className="px-2 py-1 flex gap-2">
                    <Button className="px-2 py-1 text-sm" onClick={() => startEdit(item)}>編集</Button>
                    <Button className="px-2 py-1 text-sm" variant="ghost" onClick={() => handleDelete(item.id)} disabled={remove.isPending}>
                      {remove.isPending ? '削除中...' : '削除'}
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
