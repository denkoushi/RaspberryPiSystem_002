import { useEffect, useState } from 'react';

import {
  useProductionScheduleLoadBalancingCapacityBase,
  useProductionScheduleLoadBalancingClasses,
  useProductionScheduleLoadBalancingMonthlyCapacity,
  useProductionScheduleLoadBalancingTransferRules,
  useProductionScheduleLoadBalancingWorkCalendars,
  useUpdateProductionScheduleLoadBalancingCapacityBase,
  useUpdateProductionScheduleLoadBalancingClasses,
  useUpdateProductionScheduleLoadBalancingMonthlyCapacity,
  useUpdateProductionScheduleLoadBalancingTransferRules,
  useUpdateProductionScheduleLoadBalancingWorkCalendars
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { ProductionScheduleLoadBalancingWorkCalendarMode } from '../../api/client';

/** 基準能力は API 側で常に shared に保存・参照（ロケーション切替と無関係）。 */
const CAPACITY_BASE_LOCATION = 'shared';

type Props = {
  location: string;
};

function defaultYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function ProductionScheduleLoadBalancingSettingsSection({ location }: Props) {
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');

  const capacityBaseQuery = useProductionScheduleLoadBalancingCapacityBase(CAPACITY_BASE_LOCATION);
  const monthlyQuery = useProductionScheduleLoadBalancingMonthlyCapacity(location, yearMonth);
  const classesQuery = useProductionScheduleLoadBalancingClasses(location);
  const rulesQuery = useProductionScheduleLoadBalancingTransferRules(location);
  const workCalendarsQuery = useProductionScheduleLoadBalancingWorkCalendars(location);

  const [baseRows, setBaseRows] = useState<Array<{ resourceCd: string; baseAvailableMinutes: number }>>([]);
  const [monthlyRows, setMonthlyRows] = useState<Array<{ resourceCd: string; availableMinutes: number }>>([]);
  const [classRows, setClassRows] = useState<Array<{ resourceCd: string; classCode: string }>>([]);
  const [ruleRows, setRuleRows] = useState<
    Array<{ fromClassCode: string; toClassCode: string; priority: number; enabled: boolean; efficiencyRatio: number }>
  >([]);
  const [workCalendarRows, setWorkCalendarRows] = useState<
    Array<{ resourceCd: string; workCalendarMode: ProductionScheduleLoadBalancingWorkCalendarMode }>
  >([]);

  useEffect(() => {
    setBaseRows(capacityBaseQuery.data?.items ?? []);
  }, [capacityBaseQuery.data?.items]);

  useEffect(() => {
    setMonthlyRows(monthlyQuery.data?.items ?? []);
  }, [monthlyQuery.data?.items]);

  useEffect(() => {
    setClassRows(classesQuery.data?.items ?? []);
  }, [classesQuery.data?.items]);

  useEffect(() => {
    setRuleRows(rulesQuery.data?.items ?? []);
  }, [rulesQuery.data?.items]);

  useEffect(() => {
    setWorkCalendarRows(workCalendarsQuery.data?.items ?? []);
  }, [workCalendarsQuery.data?.items]);

  const mutBase = useUpdateProductionScheduleLoadBalancingCapacityBase();
  const mutMonthly = useUpdateProductionScheduleLoadBalancingMonthlyCapacity();
  const mutClasses = useUpdateProductionScheduleLoadBalancingClasses();
  const mutRules = useUpdateProductionScheduleLoadBalancingTransferRules();
  const mutWorkCalendars = useUpdateProductionScheduleLoadBalancingWorkCalendars();

  const handleSaveBase = async () => {
    setMessage(null);
    const items = baseRows
      .map((row) => ({
        resourceCd: row.resourceCd.trim(),
        baseAvailableMinutes: row.baseAvailableMinutes
      }))
      .filter((row) => row.resourceCd.length > 0);
    if (items.length === 0) {
      setMessageTone('error');
      setMessage('資源CDが1件以上必要です。');
      return;
    }
    try {
      const settings = await mutBase.mutateAsync({ location: CAPACITY_BASE_LOCATION, items });
      setBaseRows(settings.items);
      setMessageTone('success');
      setMessage(`基準能力を保存しました（全サイト共通 / ${items.length} 件）。キオスクの各工場から同じ値が参照されます。`);
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : '基準能力の保存に失敗しました');
    }
  };

  const handleSaveMonthly = async () => {
    setMessage(null);
    await mutMonthly.mutateAsync({ location, yearMonth: yearMonth.trim(), items: monthlyRows });
    setMessage(`月次能力（${yearMonth.trim()}）を保存しました`);
  };

  const handleSaveClasses = async () => {
    setMessage(null);
    await mutClasses.mutateAsync({ location, items: classRows });
    setMessage('山崩し分類を保存しました');
  };

  const handleSaveRules = async () => {
    setMessage(null);
    await mutRules.mutateAsync({ location, items: ruleRows });
    setMessage('移管ルールを保存しました');
  };

  const handleSaveWorkCalendars = async () => {
    setMessage(null);
    await mutWorkCalendars.mutateAsync({ location, items: workCalendarRows });
    setMessage('稼働日ルールを保存しました');
  };

  return (
    <>
      <Card title="負荷調整（キオスク）稼働日ルール">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            着手日・平準化タブの日割りと日次能力換算に使います。未設定の資源CDは「平日のみ」として扱われます。
          </p>
          <div className="space-y-2">
            {workCalendarRows.map((row, index) => (
              <div key={`${row.resourceCd}-${index}-wc`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.resourceCd}
                  onChange={(event) =>
                    setWorkCalendarRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, resourceCd: event.target.value } : item))
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-4"
                  placeholder="資源CD"
                />
                <select
                  value={row.workCalendarMode}
                  onChange={(event) =>
                    setWorkCalendarRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index
                          ? {
                              ...item,
                              workCalendarMode: event.target.value as ProductionScheduleLoadBalancingWorkCalendarMode
                            }
                          : item
                      )
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-5"
                >
                  <option value="weekdays">平日のみ（月〜金）</option>
                  <option value="calendar_days">暦日（土日含む）</option>
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setWorkCalendarRows((prev) => [...prev, { resourceCd: '', workCalendarMode: 'weekdays' }])
              }
            >
              行を追加
            </Button>
            <Button
              onClick={() => void handleSaveWorkCalendars()}
              disabled={mutWorkCalendars.isPending || workCalendarsQuery.isLoading}
            >
              {mutWorkCalendars.isPending ? '保存中...' : '稼働日ルールを保存'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="負荷調整（キオスク）基準能力">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            資源CDごとの基準利用可能分数（分/月相当）。月次上書きが無い場合に適用されます。
          </p>
          <p className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-slate-700">
            <strong>全サイト共通の基準値</strong>です。ページ上部の「対象ロケーション」を切り替えても、この表の内容は変わりません（保存先 siteKey:{' '}
            <span className="font-mono">{capacityBaseQuery.data?.siteKey ?? CAPACITY_BASE_LOCATION}</span>）。
            キオスク（第2工場など）も同じ基準能力を参照します。
          </p>
          <div className="space-y-2">
            {baseRows.map((row, index) => (
              <div key={`${row.resourceCd}-${index}`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.resourceCd}
                  onChange={(event) =>
                    setBaseRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, resourceCd: event.target.value } : item))
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-4"
                  placeholder="資源CD"
                />
                <input
                  type="number"
                  min={0}
                  value={row.baseAvailableMinutes}
                  onChange={(event) =>
                    setBaseRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, baseAvailableMinutes: Number(event.target.value) || 0 } : item
                      )
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-3"
                  placeholder="利用可能分"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setBaseRows((prev) => [...prev, { resourceCd: '', baseAvailableMinutes: 0 }])
              }
            >
              行を追加
            </Button>
            <Button onClick={() => void handleSaveBase()} disabled={mutBase.isPending || capacityBaseQuery.isLoading}>
              {mutBase.isPending ? '保存中...' : '基準能力を保存'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="負荷調整（キオスク）月次能力（上書き）">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            指定した YYYY-MM にのみ適用される資源CD別の利用可能分数。基準能力より優先されます。
          </p>
          <label className="block text-xs font-semibold text-slate-700">
            対象月
            <input
              type="month"
              value={yearMonth}
              onChange={(event) => setYearMonth(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-xs md:w-auto"
            />
          </label>
          <div className="space-y-2">
            {monthlyRows.map((row, index) => (
              <div key={`${row.resourceCd}-${index}-m`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.resourceCd}
                  onChange={(event) =>
                    setMonthlyRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, resourceCd: event.target.value } : item))
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-4"
                  placeholder="資源CD"
                />
                <input
                  type="number"
                  min={0}
                  value={row.availableMinutes}
                  onChange={(event) =>
                    setMonthlyRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, availableMinutes: Number(event.target.value) || 0 } : item
                      )
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-3"
                  placeholder="利用可能分"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setMonthlyRows((prev) => [...prev, { resourceCd: '', availableMinutes: 0 }])
              }
            >
              行を追加
            </Button>
            <Button onClick={() => void handleSaveMonthly()} disabled={mutMonthly.isPending || monthlyQuery.isLoading}>
              {mutMonthly.isPending ? '保存中...' : '月次能力を保存'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="負荷調整（キオスク）山崩し分類">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            資源CDごとのクラスコード（例: LINE-A）。移管ルールの from/to に対応させます。
          </p>
          <div className="space-y-2">
            {classRows.map((row, index) => (
              <div key={`${row.resourceCd}-${index}-c`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.resourceCd}
                  onChange={(event) =>
                    setClassRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, resourceCd: event.target.value } : item))
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-4"
                  placeholder="資源CD"
                />
                <input
                  value={row.classCode}
                  onChange={(event) =>
                    setClassRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, classCode: event.target.value } : item))
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-5"
                  placeholder="クラスコード"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setClassRows((prev) => [...prev, { resourceCd: '', classCode: '' }])}>
              行を追加
            </Button>
            <Button onClick={() => void handleSaveClasses()} disabled={mutClasses.isPending || classesQuery.isLoading}>
              {mutClasses.isPending ? '保存中...' : '分類を保存'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="負荷調整（キオスク）移管ルール">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            クラス間の移管候補ルール（優先・有効・効率係数）。サジェストは自動適用せず候補提示のみです。
          </p>
          <div className="space-y-2">
            {ruleRows.map((row, index) => (
              <div key={`${row.fromClassCode}-${row.toClassCode}-${index}-r`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.fromClassCode}
                  onChange={(event) =>
                    setRuleRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, fromClassCode: event.target.value } : item))
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-3"
                  placeholder="元クラス"
                />
                <input
                  value={row.toClassCode}
                  onChange={(event) =>
                    setRuleRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, toClassCode: event.target.value } : item))
                    )
                  }
                  className="col-span-6 rounded-md border border-slate-300 p-2 text-xs md:col-span-3"
                  placeholder="先クラス"
                />
                <input
                  type="number"
                  min={1}
                  value={row.priority}
                  onChange={(event) =>
                    setRuleRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, priority: Number(event.target.value) || 1 } : item
                      )
                    )
                  }
                  className="col-span-4 rounded-md border border-slate-300 p-2 text-xs md:col-span-2"
                  placeholder="優先"
                />
                <label className="col-span-4 flex items-center gap-2 text-xs font-semibold text-slate-700 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) =>
                      setRuleRows((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, enabled: event.target.checked } : item))
                      )
                    }
                  />
                  有効
                </label>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={row.efficiencyRatio}
                  onChange={(event) =>
                    setRuleRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, efficiencyRatio: Number(event.target.value) || 1 } : item
                      )
                    )
                  }
                  className="col-span-12 rounded-md border border-slate-300 p-2 text-xs md:col-span-2"
                  placeholder="効率"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setRuleRows((prev) => [
                  ...prev,
                  { fromClassCode: '', toClassCode: '', priority: prev.length + 1, enabled: true, efficiencyRatio: 1 }
                ])
              }
            >
              ルールを追加
            </Button>
            <Button onClick={() => void handleSaveRules()} disabled={mutRules.isPending || rulesQuery.isLoading}>
              {mutRules.isPending ? '保存中...' : 'ルールを保存'}
            </Button>
          </div>
        </div>
      </Card>

      {message ? (
        <p
          className={`text-xs font-semibold ${messageTone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}
        >
          {message}
        </p>
      ) : null}
      {mutBase.isError ? (
        <p className="text-xs font-semibold text-rose-700">基準能力の保存に失敗しました（通信または権限を確認してください）。</p>
      ) : null}
    </>
  );
}
