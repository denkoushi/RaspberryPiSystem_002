import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  createPartMeasurementTemplate,
  createPartMeasurementVisualTemplate,
  getResolvedClientKey,
  listPartMeasurementVisualTemplates
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateScope,
  PartMeasurementVisualTemplateDto
} from '../../features/part-measurement/types';

type LocationState = {
  fhincd: string;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup;
  /** 候補1要素登録時の初期値 */
  fhinmei?: string;
  templateName?: string;
};

const emptyItem = () => ({
  sortOrder: 0,
  datumSurface: '',
  measurementPoint: '',
  measurementLabel: '',
  displayMarker: '',
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
  const [templateScope, setTemplateScope] = useState<PartMeasurementTemplateScope>('three_key');
  const [candidateFhinmei, setCandidateFhinmei] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [visuals, setVisuals] = useState<PartMeasurementVisualTemplateDto[]>([]);
  const [visualChoice, setVisualChoice] = useState<'none' | 'pick' | 'upload'>('none');
  const [pickedVisualId, setPickedVisualId] = useState('');
  const [newVisualName, setNewVisualName] = useState('');
  const [newVisualFile, setNewVisualFile] = useState<File | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listPartMeasurementVisualTemplates(undefined, clientKey);
        setVisuals(list);
      } catch {
        setVisuals([]);
      }
    })();
  }, [clientKey]);

  useEffect(() => {
    const m = fixed?.fhinmei?.trim();
    if (m) setCandidateFhinmei(m);
  }, [fixed?.fhinmei]);

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
    if (templateScope === 'fhinmei_only' && candidateFhinmei.trim().length === 0) {
      setMessage('FHINMEI（候補キー）を入力してください。');
      return;
    }
    const templateName = (
      name.trim() ||
      (templateScope === 'fhinmei_only'
        ? `FHINMEI:${candidateFhinmei.trim().slice(0, 40)}`
        : `${fhincd} (${processGroup})`)
    ).slice(0, 200);
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
    setBusy(true);
    try {
      let visualTemplateId: string | null = null;
      if (visualChoice === 'pick' && pickedVisualId.trim()) {
        visualTemplateId = pickedVisualId.trim();
      } else if (visualChoice === 'upload') {
        if (!newVisualFile) {
          setMessage('図面画像ファイルを選択してください。');
          setBusy(false);
          return;
        }
        const createdVt = await createPartMeasurementVisualTemplate(
          newVisualName.trim() || templateName,
          newVisualFile,
          clientKey
        );
        visualTemplateId = createdVt.id;
      }

      await createPartMeasurementTemplate(
        {
          templateScope,
          fhincd: templateScope === 'fhinmei_only' ? '' : fhincd,
          resourceCd: templateScope === 'fhinmei_only' ? '' : resourceCd,
          processGroup,
          name: templateName,
          visualTemplateId,
          candidateFhinmei: templateScope === 'fhinmei_only' ? candidateFhinmei.trim() : null,
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
            {templateScope === 'three_key'
              ? '品番・資源CD・工程は日程行から固定されています（正本3要素）。'
              : templateScope === 'fhincd_resource'
                ? '品番・資源CDは日程どおり。工程は登録時は内部用で、記録開始時に日程工程へ複製されます。'
                : 'FHINMEI 候補として登録します。品番・資源は内部キーが自動付与され、キオスクでは日程品名と照合されます。'}
          </p>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            登録スコープ
            <select
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={templateScope}
              onChange={(e) => setTemplateScope(e.target.value as PartMeasurementTemplateScope)}
            >
              <option value="three_key">正本（3要素）</option>
              <option value="fhincd_resource">候補（FIHNCD+資源CD）</option>
              <option value="fhinmei_only">候補（FHINMEI）</option>
            </select>
          </label>
          {templateScope === 'fhinmei_only' ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              FHINMEI（候補キー）
              <Input
                value={candidateFhinmei}
                onChange={(e) => setCandidateFhinmei(e.target.value)}
                className="text-slate-900"
                placeholder="日程品名と一致させる文字列"
              />
            </label>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            テンプレート名
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-slate-900" />
          </label>

          <fieldset className="grid gap-2 rounded border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">図面テンプレート（任意）</legend>
            <p className="text-xs text-slate-600">
              図面付きで測定する場合、既存の図面を選ぶか、新規に画像（PNG/JPEG/WebP）をアップロードしてください。
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="vc"
                checked={visualChoice === 'none'}
                onChange={() => setVisualChoice('none')}
              />
              図面なし
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="vc"
                checked={visualChoice === 'pick'}
                onChange={() => setVisualChoice('pick')}
              />
              既存から選択
            </label>
            {visualChoice === 'pick' ? (
              <select
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={pickedVisualId}
                onChange={(e) => setPickedVisualId(e.target.value)}
              >
                <option value="">選択してください</option>
                {visuals.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="vc"
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
                    className="text-slate-900"
                    placeholder="省略時は業務テンプレ名を使用"
                  />
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  画像ファイル
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="text-sm text-slate-900"
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
                  placeholder="図番号（表示用・任意）"
                  value={it.displayMarker}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], displayMarker: e.target.value };
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
