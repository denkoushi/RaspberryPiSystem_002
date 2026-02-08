import { FormEvent, useState } from 'react';

import {
  useInstrumentTags,
  useInstrumentTagMutations,
  useMeasuringInstrument
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useConfirm } from '../../contexts/ConfirmContext';

export function InstrumentTagsPage() {
  const [instrumentId, setInstrumentId] = useState('');
  const [tagUid, setTagUid] = useState('');
  const confirm = useConfirm();

  const { data: instrument } = useMeasuringInstrument(instrumentId || undefined);
  const { data: tags } = useInstrumentTags(instrumentId || undefined);
  const mutations = useInstrumentTagMutations(instrumentId || '');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!instrumentId || !tagUid) return;
    await mutations.create.mutateAsync(tagUid);
    setTagUid('');
  };

  const handleDelete = async (tagId: string) => {
    const shouldDelete = await confirm({
      title: 'このRFIDタグ紐付けを削除しますか？',
      description: '削除すると元に戻せません。',
      confirmLabel: '削除',
      cancelLabel: 'キャンセル',
      tone: 'danger'
    });
    if (!shouldDelete) return;
    await mutations.remove.mutateAsync(tagId);
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
                setTagUid('');
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

      <Card title="RFIDタグ 紐付け">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            RFIDタグUID
            <Input value={tagUid} onChange={(e) => setTagUid(e.target.value)} disabled={!instrumentId} required />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={!instrumentId || mutations.create.isPending}>
              {mutations.create.isPending ? '送信中…' : '紐付け登録'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="RFIDタグ一覧">
        {!instrumentId ? (
          <p className="text-sm text-slate-600">計測機器IDを入力してください。</p>
        ) : !tags ? (
          <p className="text-sm font-semibold text-slate-700">読み込み中…</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-slate-600">紐付けはありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-200 text-left">
                <tr className="border-b-2 border-slate-500">
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">RFIDタグUID</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.id} className="border-t border-slate-500">
                    <td className="px-2 py-1 text-sm text-slate-700">{tag.rfidTagUid}</td>
                    <td className="px-2 py-1 space-x-2">
                      <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => handleDelete(tag.id)}>
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
