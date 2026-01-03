import axios from 'axios';
import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useEmployeeMutations, useEmployees } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { Employee } from '../../api/types';

const initialForm = {
  employeeCode: '',
  lastName: '',
  firstName: '',
  department: '',
  nfcTagUid: ''
};

export function EmployeesPage() {
  const { data, isLoading } = useEmployees();
  const { create, update, remove } = useEmployeeMutations();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  // スコープ分離: このページがアクティブな場合のみNFCを有効にする
  const location = useLocation();
  const isActiveRoute = location.pathname.endsWith('/employees');
  const nfcEvent = useNfcStream(isActiveRoute);

  useEffect(() => {
    if (nfcEvent?.uid) {
      setForm((prev) => ({ ...prev, nfcTagUid: nfcEvent.uid }));
    }
  }, [nfcEvent]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (editingId) {
        await update.mutateAsync({
          id: editingId,
          payload: {
            employeeCode: form.employeeCode,
            lastName: form.lastName,
            firstName: form.firstName,
            department: form.department || undefined,
            nfcTagUid: form.nfcTagUid || undefined
          }
        });
      } else {
        await create.mutateAsync({
          employeeCode: form.employeeCode,
          lastName: form.lastName,
          firstName: form.firstName,
          department: form.department || undefined,
          nfcTagUid: form.nfcTagUid || undefined
        });
      }
      setForm(initialForm);
      setEditingId(null);
    } catch (error) {
      // エラーはReact Queryが自動的に処理する（create.errorまたはupdate.errorに設定される）
      // エラーメッセージはフォームの下に表示される
    }
  };

  const startEdit = (emp: Employee) => {
    setEditingId(emp.id);
    // lastName/firstNameが存在する場合はそれを使用、ない場合はdisplayNameから分割を試みる
    let lastName = emp.lastName ?? '';
    let firstName = emp.firstName ?? '';
    
    if (!lastName && !firstName && emp.displayName) {
      // displayNameから分割を試みる（スペースで分割）
      const parts = emp.displayName.trim().split(/\s+/);
      if (parts.length >= 2) {
        lastName = parts[0];
        firstName = parts.slice(1).join(' ');
      } else if (parts.length === 1) {
        // 分割できない場合はlastNameに設定
        lastName = parts[0];
      }
    }
    
    setForm({
      employeeCode: emp.employeeCode,
      lastName,
      firstName,
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
        // エラーはReact Queryが自動的に処理する（remove.errorに設定される）
        console.error('Delete error:', error);
      }
    }
  };

  return (
    <div className="space-y-6">
      <Card title="従業員登録 / 編集">
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
            社員コード
            <Input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            苗字
            <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            名前
            <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            部署
            <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
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
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">氏名</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">社員コード</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">部署</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">NFC UID</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((employee) => (
                <tr key={employee.id} className="border-t border-slate-500">
                  <td className="px-2 py-1 text-sm text-slate-700">{employee.displayName}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{employee.employeeCode}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{employee.department ?? '-'}</td>
                  <td className="px-2 py-1 font-mono text-xs text-slate-700">{employee.nfcTagUid ?? '-'}</td>
                  <td className="px-2 py-1 flex gap-2">
                    <Button className="px-2 py-1 text-xs" onClick={() => startEdit(employee)}>編集</Button>
                    <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => handleDelete(employee.id)} disabled={remove.isPending}>
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
