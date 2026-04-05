import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import {
  activatePartMeasurementTemplate,
  createPartMeasurementTemplate,
  createPartMeasurementVisualTemplate,
  listPartMeasurementTemplates,
  listPartMeasurementVisualTemplates,
  revisePartMeasurementTemplate
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import {
  buildTemplateItemsPayload,
  mapTemplateDtoToAdminFormFields
} from '../../features/part-measurement/admin/partMeasurementTemplateAdminFormModel';

import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateDto,
  PartMeasurementTemplateScope
} from '../../features/part-measurement/types';

function templateScopeLabel(s: PartMeasurementTemplateScope): string {
  switch (s) {
    case 'three_key':
      return '正本（3要素）';
    case 'fhincd_resource':
      return '候補（2要素）';
    case 'fhinmei_only':
      return '候補（1要素・FHINMEI）';
    default:
      return s;
  }
}

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
  const [templateScope, setTemplateScope] = useState<PartMeasurementTemplateScope>('three_key');
  const [candidateFhinmei, setCandidateFhinmei] = useState('');
  const [name, setName] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [message, setMessage] = useState<string | null>(null);
  const [visualChoice, setVisualChoice] = useState<'none' | 'pick' | 'upload'>('none');
  const [pickedVisualId, setPickedVisualId] = useState('');
  const [newVisualName, setNewVisualName] = useState('');
  const [newVisualFile, setNewVisualFile] = useState<File | null>(null);
  const [showInactiveTemplates, setShowInactiveTemplates] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['part-measurement-templates', { includeInactive: showInactiveTemplates }],
    queryFn: () => listPartMeasurementTemplates({ includeInactive: showInactiveTemplates })
  });

  const visualsQuery = useQuery({
    queryKey: ['part-measurement-visual-templates'],
    queryFn: () => listPartMeasurementVisualTemplates({ includeInactive: true })
  });

  const resetNewForm = () => {
    setName('');
    setFhincd('');
    setResourceCd('');
    setProcessGroup('cutting');
    setTemplateScope('three_key');
    setCandidateFhinmei('');
    setItems([emptyItem()]);
    setVisualChoice('none');
    setPickedVisualId('');
    setNewVisualName('');
    setNewVisualFile(null);
    setEditingTemplateId(null);
  };

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createPartMeasurementTemplate>[0]) => createPartMeasurementTemplate(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['part-measurement-templates'] });
      void qc.invalidateQueries({ queryKey: ['part-measurement-visual-templates'] });
      setMessage('テンプレートを登録しました。');
      resetNewForm();
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

  const reviseMutation = useMutation({
    mutationFn: (args: { templateId: string; body: Parameters<typeof revisePartMeasurementTemplate>[1] }) =>
      revisePartMeasurementTemplate(args.templateId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['part-measurement-templates'] });
      void qc.invalidateQueries({ queryKey: ['part-measurement-visual-templates'] });
      setMessage('保存しました。');
      resetNewForm();
    },
    onError: (e: Error & { response?: { data?: { message?: string } } }) => {
      setMessage(e.response?.data?.message ?? e.message ?? '保存に失敗しました。');
    }
  });

  const startEditFromDto = (t: PartMeasurementTemplateDto) => {
    setMessage(null);
    const fields = mapTemplateDtoToAdminFormFields(t);
    setTemplateScope(fields.templateScope);
    setFhincd(fields.fhincd);
    setResourceCd(fields.resourceCd);
    setProcessGroup(fields.processGroup);
    setCandidateFhinmei(fields.candidateFhinmei);
    setName(fields.name);
    setItems(fields.items);
    setVisualChoice(fields.visualChoice);
    setPickedVisualId(fields.pickedVisualId);
    setNewVisualName('');
    setNewVisualFile(null);
    setEditingTemplateId(t.id);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void (async () => {
      setMessage(null);

      const templateName = (
        name.trim() ||
        (templateScope === 'fhinmei_only'
          ? `FHINMEI:${candidateFhinmei.trim().slice(0, 40)}`
          : `${fhincd.trim()} (${processGroup})`)
      ).slice(0, 200);

      const itemsPayload = buildTemplateItemsPayload(items);
      if ('error' in itemsPayload) {
        setMessage(itemsPayload.error);
        return;
      }
      const trimmedItems = itemsPayload;

      if (editingTemplateId) {
        if (
          !window.confirm(
            '保存すると、これまでの有効版は新しい版に置き換わります（過去に記録済みのデータは変わりません）。続けますか？'
          )
        ) {
          return;
        }

        let visualTemplateId: string | null | undefined;
        if (visualChoice === 'none') {
          visualTemplateId = null;
        } else if (visualChoice === 'pick') {
          const id = pickedVisualId.trim();
          if (!id) {
            setMessage('図面テンプレを選択するか、「図面なし」にしてください。');
            return;
          }
          visualTemplateId = id;
        } else {
          if (!newVisualFile) {
            setMessage('図面画像ファイルを選択してください。');
            return;
          }
          try {
            const v = await createPartMeasurementVisualTemplate(newVisualName.trim() || templateName, newVisualFile);
            visualTemplateId = v.id;
          } catch (err: unknown) {
            const er = err as { response?: { data?: { message?: string } }; message?: string };
            setMessage(er.response?.data?.message ?? er.message ?? '図面のアップロードに失敗しました。');
            return;
          }
        }

        reviseMutation.mutate({
          templateId: editingTemplateId,
          body: {
            name: templateName,
            items: trimmedItems,
            visualTemplateId
          }
        });
        return;
      }

      const trimmedFhincd = fhincd.trim();
      const trimmedResourceCd = resourceCd.trim();
      if (templateScope === 'fhinmei_only') {
        const mei = candidateFhinmei.trim();
        if (mei.length === 0) {
          setMessage('FHINMEI（候補キー）を入力してください。');
          return;
        }
        if (mei.length < 2) {
          setMessage('FHINMEI（候補キー）は 2 文字以上にしてください。');
          return;
        }
      } else {
        if (!trimmedFhincd) {
          setMessage('FIHNCD を入力してください。');
          return;
        }
        if (!trimmedResourceCd) {
          setMessage('資源CDを入力してください。');
          return;
        }
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
        templateScope,
        fhincd: templateScope === 'fhinmei_only' ? '' : trimmedFhincd,
        resourceCd: templateScope === 'fhinmei_only' ? '' : trimmedResourceCd,
        processGroup,
        name: templateName,
        visualTemplateId,
        candidateFhinmei: templateScope === 'fhinmei_only' ? candidateFhinmei.trim() : null,
        items: trimmedItems
      });
    })();
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">部品測定テンプレート</h1>
      {message ? <p className="text-sm font-semibold text-amber-800">{message}</p> : null}

      <Card title={editingTemplateId ? 'テンプレートを編集' : '新規テンプレート（新バージョンとして登録）'}>
        <form onSubmit={handleSubmit} className="grid max-w-3xl gap-4">
          {editingTemplateId ? (
            <p className="text-xs text-slate-600">
              登録スコープ・FIHNCD・資源CD・工程・FHINMEI候補キーは変更できません（保存すると新しい版として登録されます）。
            </p>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            登録スコープ
            <select
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={templateScope}
              disabled={Boolean(editingTemplateId)}
              onChange={(e) => setTemplateScope(e.target.value as PartMeasurementTemplateScope)}
            >
              <option value="three_key">正本 — FIHNCD + 工程 + 資源CD（標準）</option>
              <option value="fhincd_resource">候補 — FIHNCD + 資源CD（工程は日程側で複製時に確定）</option>
              <option value="fhinmei_only">候補 — FHINMEI のみ（キオスクは日程品名と照合）</option>
            </select>
            <span className="text-xs font-normal text-slate-500">
              {templateScope === 'three_key'
                ? '日程の3要素と一致する正本テンプレとして登録します。'
                : templateScope === 'fhincd_resource'
                  ? '品番・資源で候補抽出されます。記録開始時に日程の工程を含む3要素テンプレへ自動複製されます。'
                  : '登録したキーワードが正規化後の日程品名に「含まれる」と候補に出ます（英字の大小・空白・全半角の揺れを吸収。2文字以上）。記録開始時に3要素テンプレへ自動複製されます。'}
            </span>
          </label>
          {templateScope === 'fhinmei_only' ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              FHINMEI（候補キー・必須）
              <Input
                value={candidateFhinmei}
                onChange={(e) => setCandidateFhinmei(e.target.value)}
                placeholder="日程品名に含めたいキーワード（2文字以上。例: シャフト → シャフト特殊品 にも候補表示）"
                required
                disabled={Boolean(editingTemplateId)}
              />
            </label>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            FIHNCD（品番）
            <Input
              value={fhincd}
              onChange={(e) => setFhincd(e.target.value)}
              required={templateScope !== 'fhinmei_only'}
              disabled={templateScope === 'fhinmei_only' || Boolean(editingTemplateId)}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            資源CD
            <Input
              value={resourceCd}
              onChange={(e) => setResourceCd(e.target.value)}
              required={templateScope !== 'fhinmei_only'}
              disabled={templateScope === 'fhinmei_only' || Boolean(editingTemplateId)}
              placeholder="例: 設備コード"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            工程（正本のみ使用。候補2要素ではDB内部用のため選択は参考表示）
            <select
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={processGroup}
              onChange={(e) => setProcessGroup(e.target.value as PartMeasurementProcessGroup)}
              disabled={templateScope !== 'three_key' || Boolean(editingTemplateId)}
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

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={createMutation.isPending || reviseMutation.isPending}
            >
              {editingTemplateId
                ? reviseMutation.isPending
                  ? '保存中…'
                  : '保存'
                : createMutation.isPending
                  ? '登録中…'
                  : '登録'}
            </Button>
            {editingTemplateId ? (
              <Button
                type="button"
                variant="secondary"
                disabled={reviseMutation.isPending}
                onClick={() => {
                  resetNewForm();
                  setMessage(null);
                }}
              >
                編集をキャンセル
              </Button>
            ) : null}
          </div>
          {visualsQuery.isError ? (
            <p className="text-xs text-amber-700">図面テンプレ一覧の取得に失敗しました（図面選択のみ影響）。</p>
          ) : null}
        </form>
      </Card>

      <Card title="登録済みテンプレート">
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showInactiveTemplates}
            onChange={(e) => setShowInactiveTemplates(e.target.checked)}
          />
          無効版も表示（有効版の切り替え用）
        </label>
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
                    {templateScopeLabel(t.templateScope)} · {t.fhincd} / {t.resourceCd} /{' '}
                    {t.processGroup ?? '—'} / v{t.version} {t.isActive ? '（有効）' : ''}
                  </p>
                  <p className="text-sm text-slate-600">{t.name}</p>
                  {t.candidateFhinmei ? (
                    <p className="text-xs text-slate-600">FHINMEI候補: {t.candidateFhinmei}</p>
                  ) : null}
                  <p className="text-xs text-slate-500">項目数: {t.items.length}</p>
                  {t.visualTemplate ? (
                    <p className="text-xs text-slate-500">図面: {t.visualTemplate.name}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {t.isActive ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={reviseMutation.isPending}
                      onClick={() => startEditFromDto(t)}
                    >
                      編集
                    </Button>
                  ) : null}
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
