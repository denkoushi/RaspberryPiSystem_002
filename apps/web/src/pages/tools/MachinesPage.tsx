import axios from 'axios';
import { FormEvent, useState } from 'react';

import { useMachineMutations, useMachines } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useConfirm } from '../../contexts/ConfirmContext';

import type { Machine } from '../../api/client';

const initialForm = {
  equipmentManagementNumber: '',
  name: '',
  shortName: '',
  classification: '',
  operatingStatus: '',
  ncManual: '',
  maker: '',
  processClassification: '',
  coolant: ''
};

export function MachinesPage() {
  const [search, setSearch] = useState('');
  const [operatingStatusFilter, setOperatingStatusFilter] = useState<string>('');
  const { data, isLoading } = useMachines({ search: search || undefined, operatingStatus: operatingStatusFilter || undefined });
  const { create, update, remove } = useMachineMutations();
  const confirm = useConfirm();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (editingId) {
        await update.mutateAsync({
          id: editingId,
          payload: {
            name: form.name,
            shortName: form.shortName || undefined,
            classification: form.classification || undefined,
            operatingStatus: form.operatingStatus || undefined,
            ncManual: form.ncManual || undefined,
            maker: form.maker || undefined,
            processClassification: form.processClassification || undefined,
            coolant: form.coolant || undefined
          }
        });
      } else {
        await create.mutateAsync({
          equipmentManagementNumber: form.equipmentManagementNumber,
          name: form.name,
          shortName: form.shortName || undefined,
          classification: form.classification || undefined,
          operatingStatus: form.operatingStatus || undefined,
          ncManual: form.ncManual || undefined,
          maker: form.maker || undefined,
          processClassification: form.processClassification || undefined,
          coolant: form.coolant || undefined
        });
      }
      setForm(initialForm);
      setEditingId(null);
    } catch (error) {
      // エラーはReact Queryが自動的に処理する（create.errorまたはupdate.errorに設定される）
      // エラーメッセージはフォームの下に表示される
    }
  };

  const startEdit = (machine: Machine) => {
    setEditingId(machine.id);
    setForm({
      equipmentManagementNumber: machine.equipmentManagementNumber,
      name: machine.name,
      shortName: machine.shortName ?? '',
      classification: machine.classification ?? '',
      operatingStatus: machine.operatingStatus ?? '',
      ncManual: machine.ncManual ?? '',
      maker: machine.maker ?? '',
      processClassification: machine.processClassification ?? '',
      coolant: machine.coolant ?? ''
    });
  };

  const handleDelete = async (id: string) => {
    const shouldDelete = await confirm({
      title: 'この加工機を削除しますか？',
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
        setForm(initialForm);
      }
    } catch (error) {
      // エラーはReact Queryが自動的に処理する（remove.errorに設定される）
      console.error('Delete error:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card title="加工機登録 / 編集">
        {(create.error || update.error) ? (
          <div className="mb-4 rounded-lg border-2 border-red-700 bg-red-600 p-4 text-sm font-semibold text-white shadow-lg">
            <p className="font-semibold">エラー</p>
            {(() => {
              const error = create.error || update.error;
              if (axios.isAxiosError(error) && error.response?.data) {
                const data = error.response.data;
                // Zodバリデーションエラーの場合、issuesからメッセージを抽出
                if (data.issues && Array.isArray(data.issues) && data.issues.length > 0) {
                  return (
                    <div className="mt-1">
                      {data.issues.map((issue: { path?: (string | number)[]; message?: string }, index: number) => (
                        <p key={index} className="mt-1">
                          {issue.path && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}
                          {issue.message}
                        </p>
                      ))}
                    </div>
                  );
                }
                // 通常のエラーメッセージ
                if (data.message) {
                  return <p className="mt-1">{data.message}</p>;
                }
              }
              return <p className="mt-1">{(error as Error)?.message || '登録・更新に失敗しました'}</p>;
            })()}
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            設備管理番号 {editingId ? '(編集不可)' : ''}
            <Input
              value={form.equipmentManagementNumber}
              onChange={(e) => setForm({ ...form, equipmentManagementNumber: e.target.value })}
              required
              disabled={!!editingId}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            加工機名称
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            加工機略称
            <Input value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            加工機分類
            <Input value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            稼働状態
            <Input value={form.operatingStatus} onChange={(e) => setForm({ ...form, operatingStatus: e.target.value })} placeholder="例: 稼働中" />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            NC/汎用区分
            <Input value={form.ncManual} onChange={(e) => setForm({ ...form, ncManual: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            メーカー
            <Input value={form.maker} onChange={(e) => setForm({ ...form, maker: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            工程分類
            <Input value={form.processClassification} onChange={(e) => setForm({ ...form, processClassification: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            クーラント
            <Input value={form.coolant} onChange={(e) => setForm({ ...form, coolant: e.target.value })} />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {editingId ? (update.isPending ? '更新中…' : '上書き保存') : create.isPending ? '送信中…' : '登録'}
            </Button>
            {editingId ? (
              <Button type="button" variant="ghost" className="ml-3" onClick={() => { setEditingId(null); setForm(initialForm); }}>
                編集キャンセル
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card title="加工機一覧">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="名称、設備管理番号、分類、メーカーで検索"
              className="md:max-w-xs"
            />
            <select
              className="rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-slate-900 md:max-w-xs"
              value={operatingStatusFilter}
              onChange={(e) => setOperatingStatusFilter(e.target.value)}
            >
              <option value="">すべての稼働状態</option>
              <option value="稼働中">稼働中</option>
              <option value="停止中">停止中</option>
              <option value="メンテナンス中">メンテナンス中</option>
            </select>
          </div>
        </div>
        {remove.error ? (
          <div className="mb-4 rounded-lg border-2 border-red-700 bg-red-600 p-4 text-sm font-semibold text-white shadow-lg">
            <p className="font-semibold">エラー</p>
            <p className="mt-1">
              {axios.isAxiosError(remove.error) && remove.error.response?.data?.message
                ? remove.error.response.data.message
                : (remove.error as Error).message || '削除に失敗しました'}
            </p>
          </div>
        ) : null}
        {isLoading ? (
          <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-200">
                <tr className="border-b-2 border-slate-500">
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">設備管理番号</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">加工機名称</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">略称</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">分類</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">稼働状態</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">メーカー</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((machine) => (
                  <tr key={machine.id} className="border-t border-slate-500">
                    <td className="px-2 py-1 font-mono text-sm text-slate-700">{machine.equipmentManagementNumber}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{machine.name}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{machine.shortName ?? '-'}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{machine.classification ?? '-'}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{machine.operatingStatus ?? '-'}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{machine.maker ?? '-'}</td>
                    <td className="px-2 py-1 flex gap-2">
                      <Button className="px-2 py-1 text-xs" onClick={() => startEdit(machine)}>編集</Button>
                      <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => handleDelete(machine.id)} disabled={remove.isPending}>
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
