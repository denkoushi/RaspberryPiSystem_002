import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  createPartMeasurementSheet,
  getResolvedClientKey,
  listPartMeasurementTemplateCandidates
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { allowAlternateResourceForMatchKind } from '../../features/part-measurement/template-pick/alternateResourcePolicy';
import { PartMeasurementTemplateCandidateCard } from '../../features/part-measurement/template-pick/PartMeasurementTemplateCandidateCard';

import type {
  KioskPartMeasurementTemplatePickLocationState,
  PartMeasurementTemplateCandidateDto
} from '../../features/part-measurement/types';

function hasRequiredContext(
  ctx: KioskPartMeasurementTemplatePickLocationState | null
): ctx is KioskPartMeasurementTemplatePickLocationState {
  return Boolean(
    ctx?.productNo?.trim() &&
      ctx.fseiban?.trim() &&
      ctx.fhincd?.trim() &&
      ctx.fhinmei?.trim() &&
      ctx.resourceCd?.trim()
  );
}

export function KioskPartMeasurementTemplatePickPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const clientKey = getResolvedClientKey();
  const ctx = location.state as KioskPartMeasurementTemplatePickLocationState | null;

  const [filterQ, setFilterQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const queryParams = useMemo(() => {
    if (!hasRequiredContext(ctx)) return null;
    return {
      fhincd: ctx.fhincd,
      processGroup: ctx.processGroup,
      resourceCd: ctx.resourceCd,
      fhinmei: ctx.fhinmei,
      q: filterQ.trim() || undefined
    };
  }, [ctx, filterQ]);

  const candidatesQuery = useQuery({
    queryKey: ['part-measurement-template-candidates', queryParams],
    enabled: queryParams != null,
    queryFn: async () => listPartMeasurementTemplateCandidates(queryParams!, clientKey)
  });

  const invalid = !hasRequiredContext(ctx);

  const goNewTemplate = () => {
    if (!ctx) return;
    void navigate('/kiosk/part-measurement/template/new', {
      state: {
        fhincd: ctx.fhincd,
        resourceCd: ctx.resourceCd,
        processGroup: ctx.processGroup
      }
    });
  };

  const handlePick = async (c: PartMeasurementTemplateCandidateDto) => {
    if (!hasRequiredContext(ctx) || !c.selectable) return;
    setMessage(null);
    setBusyId(c.template.id);
    try {
      const sheet = await createPartMeasurementSheet(
        {
          productNo: ctx.productNo,
          fseiban: ctx.fseiban,
          fhincd: ctx.fhincd,
          fhinmei: ctx.fhinmei,
          machineName: ctx.machineName,
          resourceCdSnapshot: ctx.resourceCd,
          processGroup: ctx.processGroup,
          templateId: c.template.id,
          scannedBarcodeRaw: ctx.scannedBarcodeRaw ?? null,
          scheduleRowId: ctx.scheduleRowId ?? undefined,
          allowAlternateResourceTemplate: allowAlternateResourceForMatchKind(c.matchKind)
        },
        clientKey
      );
      void navigate(`/kiosk/part-measurement/edit/${sheet.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '記録表の作成に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  if (invalid) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 text-white">
        <p className="text-amber-200">日程照会または生産スケジュールから開いてください。</p>
        <Button type="button" variant="secondary" onClick={() => void navigate('/kiosk/part-measurement')}>
          戻る
        </Button>
      </div>
    );
  }

  const candidates = candidatesQuery.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-white">
      <p className="mx-4 shrink-0 text-xs text-slate-400">
        テンプレートを選んで記録表を開始します。図面がある行はホバーで拡大表示されます（タッチ端末は今後の改善対象）。
      </p>

      <div className="mx-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => void navigate(-1)}>
          戻る
        </Button>
        <Button type="button" variant="secondary" onClick={goNewTemplate}>
          新規テンプレを作成
        </Button>
      </div>

      <h1 className="mx-4 shrink-0 text-xl font-bold">測定テンプレートを選択</h1>
      <div className="mx-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-400">
        <span>
          <span className="font-semibold text-slate-200">品番</span> {ctx.fhincd}
        </span>
        <span>
          <span className="font-semibold text-slate-200">資源CD</span> {ctx.resourceCd}
        </span>
        <span>
          <span className="font-semibold text-slate-200">工程</span>{' '}
          {ctx.processGroup === 'grinding' ? '研削' : '切削'}
        </span>
        <span>
          <span className="font-semibold text-slate-200">製番</span> {ctx.fseiban}
        </span>
      </div>

      {message ? <p className="mx-4 text-sm font-semibold text-amber-200">{message}</p> : null}

      <section className="flex min-h-0 flex-1 flex-col gap-4 border-y-2 border-slate-500 bg-white py-4 text-slate-900 shadow-lg">
        <div className="mx-4 flex flex-col gap-2">
          <h2 className="text-lg font-bold text-slate-800">候補テンプレート</h2>
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            絞り込み（品名・テンプレ名）
            <Input
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
              className="max-w-md text-slate-900"
              placeholder="例: シャフト"
            />
          </label>
        </div>

        <div className="mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {candidatesQuery.isLoading ? <p className="text-slate-600">読込中…</p> : null}
          {candidatesQuery.isError ? (
            <p className="text-red-700">候補の取得に失敗しました。ネットワークを確認してください。</p>
          ) : null}
          {!candidatesQuery.isLoading && candidates.length === 0 ? (
            <p className="text-slate-600">候補がありません。新規テンプレを作成してください。</p>
          ) : null}
          {candidates.map((c) => (
            <PartMeasurementTemplateCandidateCard
              key={c.template.id}
              candidate={c}
              scheduleResourceCd={ctx.resourceCd}
              busy={busyId === c.template.id}
              onPick={() => void handlePick(c)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
