import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  useRiggingGears,
  useRiggingGearMutations,
  useRiggingInspectionRecords,
  useRiggingInspectionRecordMutations
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { RiggingStatus, RiggingGear } from '../../api/types';

type FormState = Partial<RiggingGear> & { rfidTagUid?: string };

export function RiggingGearsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RiggingStatus | 'ALL'>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', managementNumber: '' });
  const [selectedForInspection, setSelectedForInspection] = useState<string | null>(null);
  const [inspectionEmployeeId, setInspectionEmployeeId] = useState('');
  const [inspectionResult, setInspectionResult] = useState<'PASS' | 'FAIL'>('PASS');
  const [inspectionNotes, setInspectionNotes] = useState('');

  const { data: riggings, isLoading } = useRiggingGears({
    search: search || undefined,
    status: status === 'ALL' ? undefined : status
  });
  const inspections = useRiggingInspectionRecords(selectedForInspection || undefined);
  const riggingMutations = useRiggingGearMutations();
  const inspectionMutations = useRiggingInspectionRecordMutations();

  const isEditing = Boolean(editingId);
  const location = useLocation();
  const isActiveRoute = location.pathname.endsWith('/rigging-gears');
  const nfcEvent = useNfcStream(isActiveRoute);

  // 管理コンソールでのUID自動入力（Pi4のNFCリーダー）
  useEffect(() => {
    if (nfcEvent?.uid) {
      setForm((prev) => ({ ...prev, rfidTagUid: nfcEvent.uid }));
    }
  }, [nfcEvent]);

  const handleSubmit = async () => {
    if (!form.name || !form.managementNumber) {
      alert('名称と管理番号は必須です');
      return;
    }
    const rawTag = form.rfidTagUid ?? '';
    const trimmedTag = rawTag.trim();
    const payload: FormState = {
      name: form.name,
      managementNumber: form.managementNumber,
      storageLocation: form.storageLocation || null,
      department: form.department || null,
      maxLoadTon: form.maxLoadTon ?? null,
      lengthMm: form.lengthMm ?? null,
      widthMm: form.widthMm ?? null,
      thicknessMm: form.thicknessMm ?? null,
      startedAt: form.startedAt || null,
      status: form.status,
      notes: form.notes || null,
      // 空文字は削除、非空はtrimして送信。未入力(null/undefined)は無変更。
      rfidTagUid: rawTag === '' ? '' : trimmedTag || undefined
    };
    let gearId = editingId;
    if (isEditing && editingId) {
      const updated = await riggingMutations.update.mutateAsync({ id: editingId, payload });
      gearId = updated?.id ?? editingId;
    } else {
      const created = await riggingMutations.create.mutateAsync(payload as { name: string; managementNumber: string });
      gearId = created?.id ?? gearId;
    }
    if (gearId) {
      await queryClient.invalidateQueries({ queryKey: ['rigging-gears'] });
    }
    setEditingId(null);
    setForm({ name: '', managementNumber: '' });
  };

  const handleEdit = (gear: RiggingGear) => {
    setEditingId(gear.id);
    setForm({
      ...gear,
      rfidTagUid: gear.tags?.[0]?.rfidTagUid ?? ''
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm('削除しますか？')) return;
    riggingMutations.remove.mutate(id);
    if (editingId === id) {
      setEditingId(null);
      setForm({ name: '', managementNumber: '' });
    }
  };

  const handleAddInspection = () => {
    if (!selectedForInspection) {
      alert('吊具を選択してください');
      return;
    }
    if (!inspectionEmployeeId) {
      alert('従業員IDを入力してください');
      return;
    }
    inspectionMutations.create.mutate({
      riggingGearId: selectedForInspection,
      employeeId: inspectionEmployeeId,
      result: inspectionResult,
      inspectedAt: new Date().toISOString(),
      notes: inspectionNotes || undefined
    });
    setInspectionNotes('');
  };

  const statusOptions: (RiggingStatus | 'ALL')[] = ['ALL', 'AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED'];

  const selectedName = useMemo(() => {
    return riggings?.find((g) => g.id === selectedForInspection)?.name ?? '';
  }, [riggings, selectedForInspection]);

  return (
    <div className="space-y-6">
      <Card title="吊具マスター">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="名称または管理番号で検索"
              className="md:max-w-xs"
            />
            <select
              className="rounded border border-white/10 bg-slate-800 px-3 py-2 text-white md:max-w-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value as RiggingStatus | 'ALL')}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[3.5fr,1fr]">
          <div className="overflow-x-auto">
            {isLoading ? (
              <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
            ) : (
              <table className="w-full table-fixed text-left text-sm min-w-[1100px]">
                <thead className="bg-slate-100">
                  <tr className="border-b-2 border-slate-500">
                    <th className="w-40 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">名称</th>
                    <th className="w-32 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">管理番号</th>
                    <th className="w-32 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">保管場所</th>
                    <th className="w-28 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">部署</th>
                    <th className="w-24 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">荷重(t)</th>
                    <th className="w-44 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">長さ/幅/厚み(mm)</th>
                    <th className="w-32 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">RFIDタグUID</th>
                    <th className="w-24 px-2 py-1 text-sm font-semibold text-slate-900 whitespace-nowrap">状態</th>
                    <th className="w-48 px-2 py-1 text-right text-sm font-semibold text-slate-900 whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {riggings?.map((gear) => (
                    <tr key={gear.id} className="border-t border-slate-500">
                      <td className="px-2 py-1 font-bold text-base text-slate-900 whitespace-nowrap text-ellipsis overflow-hidden" title={gear.name}>
                        {gear.name}
                      </td>
                      <td className="px-2 py-1 font-mono text-sm font-semibold text-slate-900 whitespace-nowrap">{gear.managementNumber}</td>
                      <td className="px-2 py-1 text-sm text-slate-700 whitespace-nowrap text-ellipsis overflow-hidden" title={gear.storageLocation ?? '-'}>
                        {gear.storageLocation ?? '-'}
                      </td>
                      <td className="px-2 py-1 text-sm text-slate-700 whitespace-nowrap text-ellipsis overflow-hidden" title={gear.department ?? '-'}>
                        {gear.department ?? '-'}
                      </td>
                      <td className="px-2 py-1 text-sm text-slate-700 whitespace-nowrap">{gear.maxLoadTon ?? '-'}</td>
                      <td className="px-2 py-1 text-sm text-slate-700 whitespace-nowrap">
                        {gear.lengthMm ?? '-'} / {gear.widthMm ?? '-'} / {gear.thicknessMm ?? '-'}
                      </td>
                      <td className="px-2 py-1 font-mono text-sm font-semibold text-slate-900 whitespace-nowrap">{gear.tags?.[0]?.rfidTagUid ?? '-'}</td>
                      <td className="px-2 py-1 text-sm text-slate-700 whitespace-nowrap">{gear.status}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" className="h-8 px-2 text-xs" onClick={() => handleEdit(gear)}>
                            編集
                          </Button>
                          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setSelectedForInspection(gear.id)}>
                            点検
                          </Button>
                          <Button variant="secondary" className="h-8 px-2 text-xs" onClick={() => handleDelete(gear.id)}>
                            削除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {riggings?.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-2 py-4 text-center text-sm text-slate-700">
                        該当する吊具がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-md border border-slate-500 bg-white/5 p-4">
            <h3 className="text-lg font-semibold">{isEditing ? '吊具編集' : '吊具登録'}</h3>
            <div className="mt-3 flex flex-col gap-2">
              <Input
                value={form.name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="名称（必須）"
              />
              <Input
                value={form.managementNumber ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, managementNumber: e.target.value }))}
                placeholder="管理番号（必須）"
              />
              <Input
                value={form.storageLocation ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, storageLocation: e.target.value }))}
                placeholder="保管場所"
              />
              <Input
                value={form.department ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                placeholder="部署"
              />
              <Input
                value={form.maxLoadTon ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, maxLoadTon: e.target.value ? Number(e.target.value) : null }))}
                placeholder="最大使用荷重(t)"
                type="number"
              />
              <Input
                value={form.lengthMm ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, lengthMm: e.target.value ? Number(e.target.value) : null }))}
                placeholder="長さ(mm)"
                type="number"
              />
              <Input
                value={form.widthMm ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, widthMm: e.target.value ? Number(e.target.value) : null }))}
                placeholder="幅(mm)"
                type="number"
              />
              <Input
                value={form.thicknessMm ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, thicknessMm: e.target.value ? Number(e.target.value) : null }))
                }
                placeholder="厚み(mm)"
                type="number"
              />
              <Input
                value={form.startedAt ? String(form.startedAt).substring(0, 10) : ''}
                onChange={(e) => setForm((f) => ({ ...f, startedAt: e.target.value || null }))}
                placeholder="使用開始日"
                type="date"
              />
              <Input
                value={form.rfidTagUid ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, rfidTagUid: e.target.value || undefined }))}
                placeholder="RFIDタグUID（任意・上書き登録）"
              />
              <div className="flex gap-2">
                <Button onClick={handleSubmit}>{isEditing ? '更新' : '登録'}</Button>
                {isEditing && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingId(null);
                      setForm({ name: '', managementNumber: '' });
                    }}
                  >
                    キャンセル
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="点検記録（簡易）">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            <select
              className="rounded border border-white/10 bg-slate-800 px-3 py-2 text-white"
              value={selectedForInspection ?? ''}
              onChange={(e) => setSelectedForInspection(e.target.value || null)}
            >
              <option value="">吊具を選択</option>
              {riggings?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.managementNumber})
                </option>
              ))}
            </select>
            <Input
              value={inspectionEmployeeId}
              onChange={(e) => setInspectionEmployeeId(e.target.value)}
              placeholder="従業員ID"
              className="md:max-w-xs"
            />
            <select
              className="rounded border border-white/10 bg-slate-800 px-3 py-2 text-white"
              value={inspectionResult}
              onChange={(e) => setInspectionResult(e.target.value as 'PASS' | 'FAIL')}
            >
              <option value="PASS">OK</option>
              <option value="FAIL">NG</option>
            </select>
            <Input
              value={inspectionNotes}
              onChange={(e) => setInspectionNotes(e.target.value)}
              placeholder="備考（任意）"
              className="md:max-w-xs"
            />
            <Button onClick={handleAddInspection} disabled={!selectedForInspection}>
              点検記録を追加
            </Button>
          </div>

          {selectedForInspection && (
            <div className="rounded-md border-2 border-slate-500 bg-slate-100 p-3 shadow-lg">
              <h4 className="text-sm font-bold text-slate-900">
                {selectedName || selectedForInspection} の点検記録
              </h4>
              {inspections.isLoading ? (
                <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
              ) : (
                <table className="mt-2 w-full text-left text-sm">
                  <thead className="bg-slate-200">
                    <tr className="border-b-2 border-slate-500">
                      <th className="px-2 py-1 text-sm font-semibold text-slate-900">結果</th>
                      <th className="px-2 py-1 text-sm font-semibold text-slate-900">従業員ID</th>
                      <th className="px-2 py-1 text-sm font-semibold text-slate-900">日時</th>
                      <th className="px-2 py-1 text-sm font-semibold text-slate-900">備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.data?.map((rec) => (
                      <tr key={rec.id} className="border-t border-slate-500">
                        <td className="px-2 py-1">
                          <span
                            className={`inline-block rounded border-2 px-2 py-0.5 text-xs font-bold shadow-lg ${
                              rec.result === 'PASS' ? 'border-emerald-700 bg-emerald-600 text-white' : 'border-red-700 bg-red-600 text-white'
                            }`}
                          >
                            {rec.result === 'PASS' ? 'OK' : 'NG'}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-sm font-semibold text-slate-900">{rec.employeeId}</td>
                        <td className="px-2 py-1 text-sm text-slate-700">
                          {new Date(rec.inspectedAt).toLocaleString()}
                        </td>
                        <td className="px-2 py-1 text-sm text-slate-700">{rec.notes ?? '-'}</td>
                      </tr>
                    ))}
                    {inspections.data?.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-sm text-slate-700">
                          点検記録がありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
