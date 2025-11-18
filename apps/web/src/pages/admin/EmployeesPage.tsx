import { FormEvent, useState } from 'react';
import { useEmployeeMutations, useEmployees } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

const initialForm = {
  employeeCode: '',
  displayName: '',
  department: '',
  nfcTagUid: ''
};

export function EmployeesPage() {
  const { data, isLoading } = useEmployees();
  const { create } = useEmployeeMutations();
  const [form, setForm] = useState(initialForm);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await create.mutateAsync({
      employeeCode: form.employeeCode,
      displayName: form.displayName,
      department: form.department || undefined,
      nfcTagUid: form.nfcTagUid || undefined
    });
    setForm(initialForm);
  };

  return (
    <div className="space-y-6">
      <Card title="従業員登録">
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
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? '送信中…' : '登録'}
          </Button>
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
                </tr>
              </thead>
              <tbody>
                {data?.map((employee) => (
                  <tr key={employee.id} className="border-t border-white/5">
                    <td className="px-2 py-1">{employee.displayName}</td>
                    <td className="px-2 py-1">{employee.employeeCode}</td>
                    <td className="px-2 py-1">{employee.department ?? '-'}</td>
                    <td className="px-2 py-1 font-mono text-xs">{employee.nfcTagUid ?? '-'}</td>
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
