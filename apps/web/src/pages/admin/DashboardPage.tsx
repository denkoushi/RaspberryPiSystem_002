import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listBusinessHermesProactiveSuggestions } from '../../api/client';
import { useActiveLoans, useEmployees, useItems, useClientStatuses, useClientAlerts, useAcknowledgeAlert } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';

import type { BusinessHermesProactiveSuggestion } from '../../api/domains/assembly';

const hermesSuggestionStatusLabel: Record<string, string> = {
  ready: '案内生成済み',
  unavailable: '利用不可',
  unknown: '根拠不明'
};

const hermesSuggestionEventLabel: Record<string, string> = {
  TORQUE_NG: '締付NG',
  USER_REQUEST: '利用者確認',
  PROCEDURE_LOAD_ERROR: '手順取得エラー',
  CHECK_REQUIRED: 'チェック要確認'
};

const hermesSuggestionTargetLabel: Record<string, string> = {
  'current-bolt': '現在の締付対象'
};

const hermesSuggestionBodyScopeLabel: Record<string, string> = {
  document: '文書全体',
  page: '該当ページ'
};


function BusinessHermesProactiveSuggestionsPanel() {
  const { user } = useAuth();
  const [suggestions, setSuggestions] = useState<BusinessHermesProactiveSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadSuggestions = useCallback(async () => {
    if (user?.role !== 'ADMIN') return;
    setLoading(true);
    setLoadError(false);
    try {
      setSuggestions(await listBusinessHermesProactiveSuggestions(20));
    } catch {
      setSuggestions([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  if (user?.role !== 'ADMIN') return null;

  return (
    <Card title="業務Hermes 自発提案（管理者確認）">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">実際の締付NGイベントから生成された提案です。利用者画面には表示されません。</p>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadSuggestions()}>
          {loading ? '読込中…' : '再読み込み'}
        </Button>
      </div>
      {loadError ? <p className="mt-3 text-sm text-rose-700" role="alert">提案を取得できません。再読み込みしてください。</p> : null}
      {!loadError && loading ? <p className="mt-3 text-sm text-slate-500">読込中…</p> : null}
      {!loadError && !loading && suggestions.length === 0 ? <p className="mt-3 text-sm text-slate-500">確認できる提案はありません。</p> : null}
      <div className="mt-3 space-y-3">
        {suggestions.map((suggestion) => (
          <article key={suggestion.id} className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
              <span>{hermesSuggestionStatusLabel[suggestion.status] ?? '状態不明'}</span>
              <span>{hermesSuggestionEventLabel[suggestion.eventCode] ?? '業務イベント'}</span>
              <time className="text-xs font-normal text-slate-500">{new Date(suggestion.createdAt).toLocaleString('ja-JP')}</time>
            </div>
            {suggestion.message ? <p className="mt-2 text-slate-700">{suggestion.message}</p> : null}
            <p className="mt-2 text-xs text-slate-500">作業セッション: {suggestion.sessionId} / 対象: {hermesSuggestionTargetLabel[suggestion.targetKey ?? ''] ?? '不明'}</p>
            {suggestion.evidence[0] ? (
              <p className="mt-1 text-xs text-slate-500">
                根拠: {suggestion.evidence[0].documentTitle} / {suggestion.evidence[0].pageIndex + 1}ページ ({hermesSuggestionBodyScopeLabel[suggestion.evidence[0].bodyScope] ?? '範囲不明'})
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </Card>
  );
}

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

      <BusinessHermesProactiveSuggestionsPanel />
    </div>
  );
}
