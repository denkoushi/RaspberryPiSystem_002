import { useEffect, useState } from 'react';

import {
  useProductionScheduleLoadBalancingCapacityBase,
  useProductionScheduleLoadBalancingClasses,
  useProductionScheduleLoadBalancingMonthlyCapacity,
  useProductionScheduleLoadBalancingTransferRules,
  useUpdateProductionScheduleLoadBalancingCapacityBase,
  useUpdateProductionScheduleLoadBalancingClasses,
  useUpdateProductionScheduleLoadBalancingMonthlyCapacity,
  useUpdateProductionScheduleLoadBalancingTransferRules
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

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

  const capacityBaseQuery = useProductionScheduleLoadBalancingCapacityBase(location);
  const monthlyQuery = useProductionScheduleLoadBalancingMonthlyCapacity(location, yearMonth);
  const classesQuery = useProductionScheduleLoadBalancingClasses(location);
  const rulesQuery = useProductionScheduleLoadBalancingTransferRules(location);

  const [baseRows, setBaseRows] = useState<Array<{ resourceCd: string; baseAvailableMinutes: number }>>([]);
  const [monthlyRows, setMonthlyRows] = useState<Array<{ resourceCd: string; availableMinutes: number }>>([]);
  const [classRows, setClassRows] = useState<Array<{ resourceCd: string; classCode: string }>>([]);
  const [ruleRows, setRuleRows] = useState<
    Array<{ fromClassCode: string; toClassCode: string; priority: number; enabled: boolean; efficiencyRatio: number }>
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

  const mutBase = useUpdateProductionScheduleLoadBalancingCapacityBase();
  const mutMonthly = useUpdateProductionScheduleLoadBalancingMonthlyCapacity();
  const mutClasses = useUpdateProductionScheduleLoadBalancingClasses();
  const mutRules = useUpdateProductionScheduleLoadBalancingTransferRules();

  const canonicalSiteKey =
    capacityBaseQuery.data?.siteKey ?? monthlyQuery.data?.siteKey ?? classesQuery.data?.siteKey ?? rulesQuery.data?.siteKey ?? '';

  const handleSaveBase = async () => {
    setMessage(null);
    await mutBase.mutateAsync({ location, items: baseRows });
    setMessage('基準能力を保存しました');
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

  return (
    <>
      <Card title="負荷調整（キオスク）基準能力">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            資源CDごとの基準利用可能分数（分/月相当）。月次上書きが無い場合に適用されます。設定キーは工場スコープ（siteKey）単位です。
          </p>
          {canonicalSiteKey ? (
            <p className="text-xs text-slate-600">
              解決済み siteKey: <span className="font-mono">{canonicalSiteKey}</span>
            </p>
          ) : null}
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

      {message ? <p className="text-xs font-semibold text-emerald-700">{message}</p> : null}
    </>
  );
}
