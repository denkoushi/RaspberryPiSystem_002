import { type FormEvent, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { createPartMeasurementTemplate, getResolvedClientKey } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { PartMeasurementProcessGroup } from '../../features/part-measurement/types';

type LocationState = {
  fhincd: string;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup;
  templateName?: string;
};

const emptyItem = () => ({
  sortOrder: 0,
  datumSurface: '',
  measurementPoint: '',
  measurementLabel: '',
  unit: '',
  allowNegative: true,
  decimalPlaces: 6
});

export function KioskPartMeasurementTemplatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const clientKey = getResolvedClientKey();
  const fixed = location.state as LocationState | null;

  const [items, setItems] = useState([emptyItem()]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fhincd = fixed?.fhincd ?? '';
  const resourceCd = fixed?.resourceCd ?? '';
  const processGroup = fixed?.processGroup ?? 'cutting';

  const title = useMemo(
    () => `テンプレート作成（${fhincd} / ${resourceCd} / ${processGroup === 'grinding' ? '研削' : '切削'}）`,
    [fhincd, resourceCd, processGroup]
  );

  if (!fixed || !fhincd || !resourceCd) {
    return (
      <div className="p-4 text-white">
        <p className="text-amber-200">日程照会から遷移するか、生産スケジュールの行から開いてください。</p>
        <Button type="button" variant="secondary" className="mt-2" onClick={() => void navigate('/kiosk/part-measurement')}>
          戻る
        </Button>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const templateName = (name.trim() || `${fhincd} (${processGroup})`).slice(0, 200);
    const trimmedItems = items
      .map((it, idx) => ({
        sortOrder: idx,
        datumSurface: it.datumSurface.trim(),
        measurementPoint: it.measurementPoint.trim(),
        measurementLabel: it.measurementLabel.trim(),
        unit: it.unit.trim() || null,
        allowNegative: it.allowNegative,
        decimalPlaces: Math.min(6, Math.max(0, Math.floor(it.decimalPlaces)))
      }))
      .filter((it) => it.datumSurface && it.measurementPoint && it.measurementLabel);
    if (trimmedItems.length === 0) {
      setMessage('測定項目を1行以上入力してください。');
      return;
    }
    setBusy(true);
    try {
      await createPartMeasurementTemplate(
        {
          fhincd,
          resourceCd,
          processGroup,
          name: templateName,
          items: trimmedItems
        },
        clientKey
      );
      void navigate('/kiosk/part-measurement', { replace: true, state: { templateCreated: true } });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? '登録に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 text-white">
      <Button type="button" variant="secondary" onClick={() => void navigate(-1)}>
        戻る
      </Button>
      <Card title={title}>
        {message ? <p className="mb-2 text-sm font-semibold text-amber-800">{message}</p> : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid max-w-3xl gap-4">
          <p className="text-sm text-slate-600">
            品番・資源CD・工程はこの画面では変更できません（日程行から固定されています）。
          </p>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            テンプレート名
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-slate-900" />
          </label>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">測定項目</p>
            {items.map((it, idx) => (
              <div key={idx} className="grid gap-2 rounded border border-slate-200 p-3 md:grid-cols-2">
                <Input
                  placeholder="基準面"
                  value={it.datumSurface}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], datumSurface: e.target.value };
                    setItems(next);
                  }}
                  className="text-slate-900"
                />
                <Input
                  placeholder="測定部位"
                  value={it.measurementPoint}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], measurementPoint: e.target.value };
                    setItems(next);
                  }}
                  className="text-slate-900"
                />
                <Input
                  placeholder="測定項目名"
                  value={it.measurementLabel}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], measurementLabel: e.target.value };
                    setItems(next);
                  }}
                  className="text-slate-900"
                />
                <Input
                  placeholder="単位"
                  value={it.unit}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], unit: e.target.value };
                    setItems(next);
                  }}
                  className="text-slate-900"
                />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  小数桁数（0〜6）
                  <Input
                    type="number"
                    min={0}
                    max={6}
                    value={it.decimalPlaces}
                    onChange={(e) => {
                      const next = [...items];
                      next[idx] = { ...next[idx], decimalPlaces: parseInt(e.target.value, 10) || 0 };
                      setItems(next);
                    }}
                    className="w-20 text-slate-900"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={it.allowNegative}
                    onChange={(e) => {
                      const next = [...items];
                      next[idx] = { ...next[idx], allowNegative: e.target.checked };
                      setItems(next);
                    }}
                  />
                  負の値を許可
                </label>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
              行を追加
            </Button>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? '登録中…' : '登録して有効化'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
