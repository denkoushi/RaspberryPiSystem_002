import { FormEvent, useEffect, useState } from 'react';
import { useEmployeeMutations, useEmployees } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useNfcStream } from '../../hooks/useNfcStream';
import type { Employee } from '../../api/types';
import axios from 'axios';

const initialForm = {
  employeeCode: '',
  displayName: '',
  department: '',
  nfcTagUid: ''
};

export function EmployeesPage() {
  const { data, isLoading } = useEmployees();
  const { create, update, remove } = useEmployeeMutations();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const nfcEvent = useNfcStream();

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
          employeeCode: form.employeeCode,
          displayName: form.displayName,
          department: form.department || undefined,
          nfcTagUid: form.nfcTagUid || undefined
        }
      });
    } else {
      await create.mutateAsync({
        employeeCode: form.employeeCode,
        displayName: form.displayName,
        department: form.department || undefined,
        nfcTagUid: form.nfcTagUid || undefined
      });
    }
    setForm(initialForm);
    setEditingId(null);
  };

  const startEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setForm({
      employeeCode: emp.employeeCode,
      displayName: emp.displayName,
      department: emp.department ?? '',
      nfcTagUid: emp.nfcTagUid ?? ''
    });
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('この従業員を削除しますか？')) {
      try {
        await remove.mutateAsync(id);
        if (editingId === id) {
          setEditingId(null);
          setForm(initialForm);
        }
      } catch (error) {
        const errorMessage = axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : (error instanceof Error ? error.message : '削除に失敗しました');
        alert(errorMessage);
      }
    }
  };

  return (
    <div className="space-y-6">
      <Card title="従業員登録 / 編集">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-white/70">
            社員コード
            <Input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} required />
          </label>
          <label className="text-sm text-white/70">
            氏名
            <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
          </label>
          <label className="text-sm text-white/70">
            部署
            <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </label>
          <label className="text-sm text-white/70">
            NFC UID
            <Input value={form.nfcTagUid} onChange={(e) => setForm({ ...form, nfcTagUid: e.target.value })} />
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

      <Card title="従業員一覧">
        {isLoading ? (
          <p>読み込み中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="px-2 py-1">氏名</th>
                  <th className="px-2 py-1">社員コード</th>
                  <th className="px-2 py-1">部署</th>
                  <th className="px-2 py-1">NFC UID</th>
                  <th className="px-2 py-1">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((employee) => (
                <tr key={employee.id} className="border-t border-white/5">
                  <td className="px-2 py-1">{employee.displayName}</td>
                  <td className="px-2 py-1">{employee.employeeCode}</td>
                  <td className="px-2 py-1">{employee.department ?? '-'}</td>
                  <td className="px-2 py-1 font-mono text-xs">{employee.nfcTagUid ?? '-'}</td>
                  <td className="px-2 py-1 flex gap-2">
                    <Button className="px-2 py-1 text-xs" onClick={() => startEdit(employee)}>編集</Button>
                    <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => handleDelete(employee.id)}>
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
