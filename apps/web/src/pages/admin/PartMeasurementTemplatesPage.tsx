import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import {
  activatePartMeasurementTemplate,
  createPartMeasurementTemplate,
  listPartMeasurementTemplates
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { PartMeasurementProcessGroup, PartMeasurementTemplateDto } from '../../features/part-measurement/types';

const emptyItem = () => ({
  sortOrder: 0,
  datumSurface: '',
  measurementPoint: '',
  measurementLabel: '',
  unit: '',
  allowNegative: true
});

export function PartMeasurementTemplatesPage() {
  const qc = useQueryClient();
  const [fhincd, setFhincd] = useState('');
  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>('cutting');
  const [name, setName] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [message, setMessage] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['part-measurement-templates', { includeInactive: true }],
    queryFn: () => listPartMeasurementTemplates({ includeInactive: true })
  });

  const createMutation = useMutation({
    mutationFn: createPartMeasurementTemplate,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['part-measurement-templates'] });
      setMessage('テンプレートを登録しました。');
      setName('');
      setItems([emptyItem()]);
    },
    onError: (e: Error & { response?: { data?: { message?: string } } }) => {
      setMessage(e.response?.data?.message ?? e.message ?? '登録に失敗しました。');
    }
  });

  const activateMutation = useMutation({
    mutationFn: activatePartMeasurementTemplate,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['part-measurement-templates'] });
      setMessage('有効版を切り替えました。');
    },
    onError: (e: Error & { response?: { data?: { message?: string } } }) => {
      setMessage(e.response?.data?.message ?? e.message ?? '切替に失敗しました。');
    }
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const trimmedFhincd = fhincd.trim();
    const templateName = (name.trim() || `${trimmedFhincd} (${processGroup})`).slice(0, 200);
    const trimmedItems = items
      .map((it, idx) => ({
        sortOrder: idx,
        datumSurface: it.datumSurface.trim(),
        measurementPoint: it.measurementPoint.trim(),
        measurementLabel: it.measurementLabel.trim(),
        unit: it.unit.trim() || null,
        allowNegative: it.allowNegative
      }))
      .filter((it) => it.datumSurface && it.measurementPoint && it.measurementLabel);
    if (trimmedItems.length === 0) {
      setMessage('測定項目を1行以上入力してください。');
      return;
    }
    createMutation.mutate({
      fhincd: trimmedFhincd,
      processGroup,
      name: templateName,
      items: trimmedItems
    });
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">部品測定テンプレート</h1>
      {message ? <p className="text-sm font-semibold text-amber-800">{message}</p> : null}

      <Card title="新規テンプレート（新バージョンとして登録）">
        <form onSubmit={handleSubmit} className="grid max-w-3xl gap-4">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            FIHNCD（品番）
            <Input value={fhincd} onChange={(e) => setFhincd(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            工程
            <select
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={processGroup}
              onChange={(e) => setProcessGroup(e.target.value as PartMeasurementProcessGroup)}
            >
              <option value="cutting">切削</option>
              <option value="grinding">研削</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            テンプレート名
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="省略時は品番+工程" />
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
                />
                <Input
                  placeholder="測定部位"
                  value={it.measurementPoint}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], measurementPoint: e.target.value };
                    setItems(next);
                  }}
                />
                <Input
                  placeholder="測定項目名"
                  value={it.measurementLabel}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], measurementLabel: e.target.value };
                    setItems(next);
                  }}
                />
                <Input
                  placeholder="単位（任意）"
                  value={it.unit}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], unit: e.target.value };
                    setItems(next);
                  }}
                />
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
            >
              行を追加
            </Button>
          </div>

          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? '登録中…' : '登録'}
          </Button>
        </form>
      </Card>

      <Card title="登録済みテンプレート">
        {listQuery.isLoading ? (
          <p className="text-sm text-slate-600">読み込み中…</p>
        ) : listQuery.isError ? (
          <p className="text-sm text-red-600">取得に失敗しました。</p>
        ) : (
          <ul className="space-y-3">
            {(listQuery.data ?? []).map((t: PartMeasurementTemplateDto) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {t.fhincd} / {t.processGroup} / v{t.version} {t.isActive ? '（有効）' : ''}
                  </p>
                  <p className="text-sm text-slate-600">{t.name}</p>
                  <p className="text-xs text-slate-500">項目数: {t.items.length}</p>
                </div>
                {!t.isActive ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={activateMutation.isPending}
                    onClick={() => activateMutation.mutate(t.id)}
                  >
                    有効化
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
