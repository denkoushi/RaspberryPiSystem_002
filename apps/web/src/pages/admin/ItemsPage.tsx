import { FormEvent, useState } from 'react';
import { useItemMutations, useItems } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

const initialItem = {
  itemCode: '',
  name: '',
  category: '',
  storageLocation: '',
  nfcTagUid: ''
};

export function ItemsPage() {
  const { data, isLoading } = useItems();
  const { create } = useItemMutations();
  const [form, setForm] = useState(initialItem);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await create.mutateAsync({
      itemCode: form.itemCode,
      name: form.name,
      category: form.category || undefined,
      storageLocation: form.storageLocation || undefined,
      nfcTagUid: form.nfcTagUid || undefined
    });
    setForm(initialItem);
  };

  return (
    <div className="space-y-6">
      <Card title="アイテム登録">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-white/70">
            管理コード
            <Input value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} required />
          </label>
          <label className="text-sm text-white/70">
            名称
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="text-sm text-white/70">
            NFC UID
            <Input value={form.nfcTagUid} onChange={(e) => setForm({ ...form, nfcTagUid: e.target.value })} />
          </label>
          <label className="text-sm text-white/70">
            カテゴリ
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <label className="text-sm text-white/70">
            保管場所
            <Input value={form.storageLocation} onChange={(e) => setForm({ ...form, storageLocation: e.target.value })} />
          </label>
        <div className="md:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? '送信中…' : '登録'}
          </Button>
        </div>
        </form>
      </Card>

      <Card title="アイテム一覧">
        {isLoading ? (
          <p>読み込み中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="px-2 py-1">名称</th>
                  <th className="px-2 py-1">管理コード</th>
                  <th className="px-2 py-1">カテゴリ</th>
                  <th className="px-2 py-1">保管場所</th>
                  <th className="px-2 py-1">NFC UID</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((item) => (
                  <tr key={item.id} className="border-t border-white/5">
                    <td className="px-2 py-1">{item.name}</td>
                    <td className="px-2 py-1">{item.itemCode}</td>
                    <td className="px-2 py-1">{item.category ?? '-'}</td>
                    <td className="px-2 py-1">{item.storageLocation ?? '-'}</td>
                    <td className="px-2 py-1 font-mono text-xs">{item.nfcTagUid ?? '-'}</td>
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
