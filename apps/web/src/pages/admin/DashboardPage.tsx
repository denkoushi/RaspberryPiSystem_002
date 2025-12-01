import { Link } from 'react-router-dom';
import { useActiveLoans, useEmployees, useItems, useClientStatuses, useClientAlerts, useAcknowledgeAlert } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export function DashboardPage() {
  const employees = useEmployees();
  const items = useItems();
  const loans = useActiveLoans();
  const clientStatuses = useClientStatuses();
  const alertsQuery = useClientAlerts();
  const acknowledgeMutation = useAcknowledgeAlert();

  // アラート情報を計算
  const alerts = alertsQuery.data?.alerts;
  const hasAlerts = alerts?.hasAlerts ?? false;
  const fileAlerts = alertsQuery.data?.details.fileAlerts ?? [];

  const handleAcknowledge = async (alertId: string) => {
    await acknowledgeMutation.mutateAsync(alertId);
  };

  return (
    <div className="space-y-6">
      {/* アラートバナー */}
      {hasAlerts && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-red-200">⚠️ アラート</h3>
              <div className="mt-2 space-y-1 text-sm text-red-100">
                {alerts && alerts.staleClients > 0 && (
                  <p>
                    <Link to="/admin/clients" className="underline">
                      {alerts.staleClients}台のクライアントが12時間以上オフラインです
                    </Link>
                  </p>
                )}
                {alerts && alerts.errorLogs > 0 && (
                  <p>
                    <Link to="/admin/clients" className="underline">
                      {alerts.errorLogs}件のエラーログが検出されました（過去24時間）
                    </Link>
                  </p>
                )}
                {fileAlerts.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold">ファイルベースのアラート:</p>
                    {fileAlerts.map((alert) => (
                      <div key={alert.id} className="ml-2 flex items-center justify-between gap-2">
                        <div>
                          <p>
                            [{alert.type}] {alert.message}
                            {alert.details && <span className="text-xs text-white/60"> ({alert.details})</span>}
                          </p>
                          <p className="text-xs text-white/60">
                            {new Date(alert.timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          onClick={() => handleAcknowledge(alert.id)}
                          disabled={acknowledgeMutation.isPending}
                        >
                          確認済み
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Link to="/admin/clients">
              <Button variant="secondary">詳細を確認</Button>
            </Link>
          </div>
        </div>
      )}

      {/* 統計カード */}
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

      {/* クライアント状態サマリー */}
      {clientStatuses.data && clientStatuses.data.length > 0 && (
        <Card title="クライアント状態サマリー">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-white/60">オンライン</p>
              <p className="text-2xl font-bold text-emerald-400">
                {clientStatuses.data.filter((c) => !c.stale).length}
              </p>
            </div>
            <div>
              <p className="text-sm text-white/60">オフライン（12時間超）</p>
              <p className="text-2xl font-bold text-red-400">
                {clientStatuses.data.filter((c) => c.stale).length}
              </p>
            </div>
          </div>
          {alerts && alerts.errorLogs > 0 && (
            <div className="mt-4">
              <p className="text-sm text-white/60">エラーログ（過去24時間）</p>
              <p className="text-2xl font-bold text-yellow-400">{alerts.errorLogs}</p>
            </div>
          )}
          <div className="mt-4">
            <Link to="/admin/clients">
              <Button variant="secondary">詳細を確認</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
