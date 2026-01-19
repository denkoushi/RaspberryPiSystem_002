import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import { useActiveLoans, useEmployees, useItems, useClientStatuses, useClientAlerts, useAcknowledgeAlert } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

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
  const dbAlerts = useMemo(() => alertsQuery.data?.details.dbAlerts ?? [], [alertsQuery.data?.details.dbAlerts]);
  const lastDbAlertsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = JSON.stringify(
      dbAlerts.map((a) => ({
        id: a.id,
        type: a.type ?? null,
        severity: a.severity ?? null,
        timestamp: a.timestamp,
        acknowledged: a.acknowledged,
      }))
    );

    if (key === lastDbAlertsKeyRef.current) return;
    lastDbAlertsKeyRef.current = key;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H1',
        location: 'apps/web/src/pages/admin/DashboardPage.tsx:DashboardPage',
        message: 'Dashboard dbAlerts changed',
        data: {
          requestId: alertsQuery.data?.requestId,
          hasAlerts,
          counts: {
            staleClients: alerts?.staleClients ?? null,
            errorLogs: alerts?.errorLogs ?? null,
            dbAlerts: alerts?.dbAlerts ?? null,
          },
          dbAlerts: dbAlerts.slice(0, 10).map((a) => ({
            id: a.id,
            type: a.type ?? null,
            severity: a.severity ?? null,
            timestamp: a.timestamp,
            acknowledged: a.acknowledged,
          })),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [alertsQuery.data?.requestId, alerts?.dbAlerts, alerts?.errorLogs, alerts?.staleClients, dbAlerts, hasAlerts]);

  const handleAcknowledge = async (alertId: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H4',
        location: 'apps/web/src/pages/admin/DashboardPage.tsx:handleAcknowledge',
        message: 'Clicked acknowledge',
        data: { alertId },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

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
                {dbAlerts.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold">アラート:</p>
                    {dbAlerts.map((alert) => (
                      <div key={alert.id} className="ml-2 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {alert.type && `[${alert.type}] `}
                            {alert.message ?? 'アラート'}
                            {alert.severity && (
                              <span className="ml-1 text-xs text-slate-600">({alert.severity})</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-600">
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
          <p className="text-4xl font-bold text-slate-900">{employees.data?.length ?? '--'}</p>
        </Card>
        <Card title="アイテム">
          <p className="text-4xl font-bold text-slate-900">{items.data?.length ?? '--'}</p>
        </Card>
        <Card title="貸出中">
          <p className="text-4xl font-bold text-slate-900">{loans.data?.length ?? '--'}</p>
        </Card>
      </div>

      {/* クライアント状態サマリー */}
      {clientStatuses.data && clientStatuses.data.length > 0 && (
        <Card title="クライアント状態サマリー">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-slate-700">オンライン</p>
              <p className="text-2xl font-bold text-emerald-600">
                {clientStatuses.data.filter((c) => !c.stale).length}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">オフライン（12時間超）</p>
              <p className="text-2xl font-bold text-red-600">
                {clientStatuses.data.filter((c) => c.stale).length}
              </p>
            </div>
          </div>
          {alerts && alerts.errorLogs > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700">エラーログ（過去24時間）</p>
              <p className="text-2xl font-bold text-yellow-600">{alerts.errorLogs}</p>
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
