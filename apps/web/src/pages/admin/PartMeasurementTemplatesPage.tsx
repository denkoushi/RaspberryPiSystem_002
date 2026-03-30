import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import {
  activatePartMeasurementTemplate,
  createPartMeasurementTemplate,
  createPartMeasurementVisualTemplate,
  listPartMeasurementTemplates,
  listPartMeasurementVisualTemplates
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
  displayMarker: '',
  unit: '',
  allowNegative: true,
  decimalPlaces: 3
});

export function PartMeasurementTemplatesPage() {
  const qc = useQueryClient();
  const [fhincd, setFhincd] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>('cutting');
  const [name, setName] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [message, setMessage] = useState<string | null>(null);
  const [visualChoice, setVisualChoice] = useState<'none' | 'pick' | 'upload'>('none');
  const [pickedVisualId, setPickedVisualId] = useState('');
  const [newVisualName, setNewVisualName] = useState('');
  const [newVisualFile, setNewVisualFile] = useState<File | null>(null);

  const listQuery = useQuery({
    queryKey: ['part-measurement-templates', { includeInactive: true }],
    queryFn: () => listPartMeasurementTemplates({ includeInactive: true })
  });

  const visualsQuery = useQuery({
    queryKey: ['part-measurement-visual-templates'],
    queryFn: () => listPartMeasurementVisualTemplates({ includeInactive: true })
  });

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createPartMeasurementTemplate>[0]) => createPartMeasurementTemplate(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['part-measurement-templates'] });
      void qc.invalidateQueries({ queryKey: ['part-measurement-visual-templates'] });
      setMessage('テンプレートを登録しました。');
      setName('');
      setResourceCd('');
      setItems([emptyItem()]);
      setVisualChoice('none');
      setPickedVisualId('');
      setNewVisualName('');
      setNewVisualFile(null);
    },
    onError: (e: Error & { response?: { data?: { message?: string } } }) => {
      setMessage(e.response?.data?.message ?? e.message ?? '登録に失敗しました。');
    }
  });

  const activateMutation = useMutation({
    mutationFn: (templateId: string) => activatePartMeasurementTemplate(templateId),
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
    void (async () => {
      setMessage(null);
      const trimmedFhincd = fhincd.trim();
      const trimmedResourceCd = resourceCd.trim();
      if (!trimmedResourceCd) {
        setMessage('資源CDを入力してください。');
        return;
      }
      const templateName = (name.trim() || `${trimmedFhincd} (${processGroup})`).slice(0, 200);
      const trimmedItems = items
        .map((it, idx) => ({
          sortOrder: idx,
          datumSurface: it.datumSurface.trim(),
          measurementPoint: it.measurementPoint.trim(),
          measurementLabel: it.measurementLabel.trim(),
          displayMarker: it.displayMarker.trim() || null,
          unit: it.unit.trim() || null,
          allowNegative: it.allowNegative,
          decimalPlaces: Math.min(6, Math.max(0, Math.floor(it.decimalPlaces)))
        }))
        .filter((it) => it.datumSurface && it.measurementPoint && it.measurementLabel);
      if (trimmedItems.length === 0) {
        setMessage('測定項目を1行以上入力してください。');
        return;
      }

      let visualTemplateId: string | null = null;
      if (visualChoice === 'pick' && pickedVisualId.trim()) {
        visualTemplateId = pickedVisualId.trim();
      } else if (visualChoice === 'upload') {
        if (!newVisualFile) {
          setMessage('図面画像ファイルを選択してください。');
          return;
        }
        try {
          const v = await createPartMeasurementVisualTemplate(
            newVisualName.trim() || templateName,
            newVisualFile
          );
          visualTemplateId = v.id;
        } catch (err: unknown) {
          const er = err as { response?: { data?: { message?: string } }; message?: string };
          setMessage(er.response?.data?.message ?? er.message ?? '図面のアップロードに失敗しました。');
          return;
        }
      }

      createMutation.mutate({
        fhincd: trimmedFhincd,
        resourceCd: trimmedResourceCd,
        processGroup,
        name: templateName,
        visualTemplateId,
        items: trimmedItems
      });
    })();
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
            資源CD
            <Input value={resourceCd} onChange={(e) => setResourceCd(e.target.value)} required placeholder="例: 設備コード" />
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

          <fieldset className="grid gap-2 rounded border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">図面テンプレート（任意）</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="adminVc"
                checked={visualChoice === 'none'}
                onChange={() => setVisualChoice('none')}
              />
              図面なし
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="adminVc"
                checked={visualChoice === 'pick'}
                onChange={() => setVisualChoice('pick')}
              />
              既存から選択
            </label>
            {visualChoice === 'pick' ? (
              <select
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                value={pickedVisualId}
                onChange={(e) => setPickedVisualId(e.target.value)}
              >
                <option value="">選択してください</option>
                {(visualsQuery.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="adminVc"
                checked={visualChoice === 'upload'}
                onChange={() => setVisualChoice('upload')}
              />
              新規アップロード
            </label>
            {visualChoice === 'upload' ? (
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-700">
                  図面テンプレ名
                  <Input
                    value={newVisualName}
                    onChange={(e) => setNewVisualName(e.target.value)}
                    placeholder="省略時は業務テンプレ名を使用"
                  />
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  画像ファイル
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="text-sm"
                    onChange={(e) => setNewVisualFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            ) : null}
          </fieldset>

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
                  placeholder="図番号（表示用・任意）"
                  value={it.displayMarker}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], displayMarker: e.target.value };
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
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  小数桁数（0〜6）
                  <Input
                    type="number"
                    min={0}
                    max={6}
                    className="w-20"
                    value={it.decimalPlaces}
                    onChange={(e) => {
                      const next = [...items];
                      next[idx] = { ...next[idx], decimalPlaces: parseInt(e.target.value, 10) || 0 };
                      setItems(next);
                    }}
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
          {visualsQuery.isError ? (
            <p className="text-xs text-amber-700">図面テンプレ一覧の取得に失敗しました（図面選択のみ影響）。</p>
          ) : null}
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
                    {t.fhincd} / {t.resourceCd} / {t.processGroup} / v{t.version} {t.isActive ? '（有効）' : ''}
                  </p>
                  <p className="text-sm text-slate-600">{t.name}</p>
                  <p className="text-xs text-slate-500">項目数: {t.items.length}</p>
                  {t.visualTemplate ? (
                    <p className="text-xs text-slate-500">図面: {t.visualTemplate.name}</p>
                  ) : null}
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
