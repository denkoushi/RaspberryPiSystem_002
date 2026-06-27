import { useState } from 'react';

import { getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import type {
  DgxBusinessModelProfileApi,
  DgxModelProfilesOverviewApi,
  DgxResourceActionBody,
  DgxResourceActionResult,
} from '../../../api/dgx-resource.types';

type Props = {
  modelProfiles?: DgxModelProfilesOverviewApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  externalBusy?: boolean;
  onControlUiError: (message: string | null) => void;
};

export function DgxResourceQuickProfileActions({
  modelProfiles,
  postDgxAction,
  actionBusy,
  externalBusy = false,
  onControlUiError,
}: Props) {
  const confirm = useConfirm();
  const [flowBusy, setFlowBusy] = useState(false);
  const [resultNote, setResultNote] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const busy = actionBusy || flowBusy || externalBusy;
  const selectable =
    modelProfiles?.available.filter((profile) => profile.enabled && profile.status === 'available') ?? [];

  const runtimeBudgetLine = (profile: DgxBusinessModelProfileApi): string | null => {
    const runtime = profile?.runtimeProfile;
    if (!runtime) return null;
    if (runtime.vllm?.gpuMemoryUtilization != null) {
      const pct = Math.round(runtime.vllm.gpuMemoryUtilization * 100);
      return `vLLM memory budget ${pct}% / ${runtime.guaranteeLevel ?? 'post_only'}`;
    }
    if (runtime.llamaCpp?.ctxSize != null) {
      return `llama.cpp ctx ${runtime.llamaCpp.ctxSize} / ${runtime.guaranteeLevel ?? 'post_only'}`;
    }
    return runtime.guaranteeLevel ?? null;
  };

  const startProfile = async (profile: DgxBusinessModelProfileApi) => {
    const modelProfileId = profile.id;

    const ok = await confirm({
      title: `${profile.displayNameJa} を起動`,
      description: [
        `modelProfileId: ${modelProfileId}`,
        '保証レベル: POSTのみ。Strict Ready確認は通しません。',
        '既存の業務モデルと同時常時オンにはなりません（単一アクティブ運用）。',
      ].join('\n'),
      tone: 'primary',
    });
    if (!ok) return;

    setFlowBusy(true);
    setResultNote(null);
    try {
      const result = await postDgxAction({
        type: 'START_MODEL_PROFILE',
        modelProfileId,
        reason: 'admin_dgx_resource_quick_profile',
      });
      onControlUiError(null);
      setResultNote({ tone: 'success', message: result.message });
    } catch (error) {
      const message = getDgxResourceApiErrorMessage(error);
      onControlUiError(message);
      setResultNote({ tone: 'error', message });
    } finally {
      setFlowBusy(false);
    }
  };

  if (modelProfiles?.status !== 'ok') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-sm font-bold text-slate-950">保守: モデルプロファイル起動</h3>
        <p className="mt-1 text-xs text-amber-700">
          {modelProfiles?.errorMessageJa ?? 'DGX model profiles を取得できないため、モデル起動は無効です'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-bold text-slate-950">保守: モデルプロファイル起動</h3>
      {selectable.length === 0 ? (
        <p className="text-xs font-semibold text-slate-500">起動可能なモデルなし</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {selectable.map((profile) => {
            const active = profile.id === modelProfiles?.activeProfileId;
            const budget = runtimeBudgetLine(profile);
            return (
              <div key={profile.id} className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={active ? 'primary' : 'secondary'}
                    disabled={busy}
                    aria-label={profile.displayNameJa}
                    onClick={() => void startProfile(profile)}
                  >
                    {profile.displayNameJa}
                  </Button>
                  <span
                    className={active ? 'h-2 w-2 rounded-full bg-emerald-700' : 'h-2 w-2 rounded-full bg-slate-400'}
                    aria-label={active ? 'active' : 'available'}
                  />
                </div>
                <p className="truncate text-[11px] font-semibold text-slate-500" title={profile.id}>
                  {profile.id}
                </p>
                {budget ? <p className="max-w-72 text-[11px] leading-snug text-slate-500">{budget}</p> : null}
              </div>
            );
          })}
        </div>
      )}
      {resultNote ? (
        <p
          role="status"
          className={
            resultNote.tone === 'success'
              ? 'text-xs text-emerald-700'
              : 'text-xs text-red-700'
          }
        >
          {resultNote.message}
        </p>
      ) : null}
    </div>
  );
}
