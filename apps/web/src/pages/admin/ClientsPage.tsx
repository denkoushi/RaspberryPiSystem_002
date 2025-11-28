import { useState } from 'react';
import { useClients, useClientMutations } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { ClientDevice } from '../../api/client';

export function ClientsPage() {
  const clientsQuery = useClients();
  const { update } = useClientMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<'PHOTO' | 'TAG' | null>(null);

  const handleEdit = (client: ClientDevice) => {
    setEditingId(client.id);
    setSelectedMode(client.defaultMode ?? 'TAG');
  };

  const handleSave = async (id: string) => {
    await update.mutateAsync({
      id,
      payload: { defaultMode: selectedMode }
    });
    setEditingId(null);
    setSelectedMode(null);
  };

  const handleCancel = () => {
    setEditingId(null);
    setSelectedMode(null);
  };

  return (
    <Card title="クライアント端末管理">
      {clientsQuery.isError ? (
        <p className="text-red-400">クライアント端末一覧の取得に失敗しました</p>
      ) : clientsQuery.isLoading ? (
        <p>読み込み中...</p>
      ) : clientsQuery.data && clientsQuery.data.length > 0 ? (
        <div className="space-y-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-2 text-left">名前</th>
                <th className="px-4 py-2 text-left">場所</th>
                <th className="px-4 py-2 text-left">APIキー</th>
                <th className="px-4 py-2 text-left">初期表示</th>
                <th className="px-4 py-2 text-left">最終確認</th>
                <th className="px-4 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {clientsQuery.data.map((client: ClientDevice) => (
                <tr key={client.id} className="border-b border-white/5">
                  <td className="px-4 py-2">{client.name}</td>
                  <td className="px-4 py-2 text-white/70">{client.location ?? '-'}</td>
                  <td className="px-4 py-2 text-xs text-white/60 font-mono">{client.apiKey}</td>
                  <td className="px-4 py-2">
                    {editingId === client.id ? (
                      <select
                        value={selectedMode ?? 'TAG'}
                        onChange={(e) => setSelectedMode(e.target.value as 'PHOTO' | 'TAG')}
                        className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white"
                      >
                        <option value="TAG">2タグスキャン</option>
                        <option value="PHOTO">写真撮影持出</option>
                      </select>
                    ) : (
                      <span>{client.defaultMode === 'PHOTO' ? '写真撮影持出' : '2タグスキャン'}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-white/60">
                    {client.lastSeenAt ? new Date(client.lastSeenAt).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2">
                    {editingId === client.id ? (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleSave(client.id)}
                          disabled={update.isPending}
                          className="px-3 py-1 text-sm"
                        >
                          保存
                        </Button>
                        <Button
                          onClick={handleCancel}
                          disabled={update.isPending}
                          variant="ghost"
                          className="px-3 py-1 text-sm"
                        >
                          キャンセル
                        </Button>
                      </div>
                    ) : (
                      <Button onClick={() => handleEdit(client)} className="px-3 py-1 text-sm">
                        編集
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>クライアント端末が登録されていません。</p>
      )}
    </Card>
  );
}

