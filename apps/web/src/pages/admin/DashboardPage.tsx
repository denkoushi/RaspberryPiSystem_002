import { useActiveLoans, useEmployees, useItems } from '../../api/hooks';
import { Card } from '../../components/ui/Card';

export function DashboardPage() {
  const employees = useEmployees();
  const items = useItems();
  const loans = useActiveLoans();

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card title="従業員">
        <p className="text-4xl font-bold">{employees.data?.length ?? '--'}</p>
      </Card>
      <Card title="アイテム">
        <p className="text-4xl font-bold">{items.data?.length ?? '--'}</p>
      </Card>
      <Card title="貸出中">
        <p className="text-4xl font-bold">{loans.data?.length ?? '--'}</p>
      </Card>
    </div>
  );
}
