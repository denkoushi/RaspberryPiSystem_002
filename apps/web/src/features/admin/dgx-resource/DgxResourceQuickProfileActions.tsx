import { useState } from 'react';

import { getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useConfirm } from '../../../contexts/ConfirmContext';

import type {
  DgxBusinessModelProfileApi,
  DgxModelStorageDeletePreviewApi,
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
  const [deletePreview, setDeletePreview] = useState<DgxModelStorageDeletePreviewApi | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
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

  const previewDelete = async (profile: DgxBusinessModelProfileApi) => {
    setFlowBusy(true);
    setResultNote(null);
    setDeletePreview(null);
    setDeleteConfirmation('');
    try {
      const result = await postDgxAction({
        type: 'PREVIEW_MODEL_STORAGE_DELETE',
        modelProfileId: profile.id,
      });
      const preview = result.modelStorageDeletePreview;
      if (!preview) {
        throw new Error(result.message || '削除プレビューを取得できませんでした');
      }
      setDeletePreview(preview);
      if (!preview.canDelete) {
        setResultNote({
          tone: 'error',
          message: preview.blockedReasons.map((reason) => reason.detailJa).join(' / ') || '削除保護中です',
        });
      }
      onControlUiError(null);
    } catch (error) {
      const message = getDgxResourceApiErrorMessage(error);
      onControlUiError(message);
      setResultNote({ tone: 'error', message });
    } finally {
      setFlowBusy(false);
    }
  };

  const executeDelete = async () => {
    if (!deletePreview?.planFingerprint || !deletePreview.canDelete) return;
    if (deleteConfirmation !== deletePreview.requiredConfirmation) {
      setResultNote({ tone: 'error', message: `確認入力は「${deletePreview.requiredConfirmation}」です` });
      return;
    }
    const ok = await confirm({
      title: `${deletePreview.displayNameJa} の保存先を削除`,
      description: [
        deletePreview.resolvedStoragePath ?? deletePreview.storagePath ?? '保存先未取得',
        `容量: ${deletePreview.sizeGiB ?? 0} GiB`,
        'profile/manifest は残ります。',
      ].join('\n'),
      confirmLabel: '削除',
      tone: 'danger',
    });
    if (!ok) return;
    setFlowBusy(true);
    setResultNote(null);
    try {
      const result = await postDgxAction({
        type: 'EXECUTE_MODEL_STORAGE_DELETE',
        modelProfileId: deletePreview.modelProfileId,
        planFingerprint: deletePreview.planFingerprint,
        confirmation: deleteConfirmation,
      });
      onControlUiError(null);
      setResultNote({ tone: 'success', message: result.message });
      setDeletePreview(null);
      setDeleteConfirmation('');
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
      <div className="rounded-lg border border-white/15 bg-slate-900/60 p-3">
        <h3 className="text-sm font-bold text-white">保守: モデルプロファイル起動</h3>
        <p className="mt-1 text-xs text-amber-300">
          {modelProfiles?.errorMessageJa ?? 'DGX model profiles を取得できないため、モデル起動は無効です'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-white/15 bg-slate-900/60 p-3">
      <h3 className="text-sm font-bold text-white">保守: モデルプロファイル起動</h3>
      {selectable.length === 0 ? (
        <p className="text-xs font-semibold text-white/60">起動可能なモデルなし</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {selectable.map((profile) => {
            const active = profile.id === modelProfiles?.activeProfileId;
            const budget = runtimeBudgetLine(profile);
            return (
              <div key={profile.id} className="space-y-2 rounded-md border border-white/15 bg-white/5 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={active ? 'primary' : 'secondary'}
                    disabled={busy || profile.startupFit?.status === 'insufficient'}
                    aria-label={profile.displayNameJa}
                    onClick={() => void startProfile(profile)}
                  >
                    {profile.displayNameJa}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || profile.deleteProtection?.canDelete !== true}
                    aria-label={`${profile.displayNameJa} の保存先削除`}
                    title={profile.deleteProtection?.reasonJa ?? '保存先削除'}
                    onClick={() => void previewDelete(profile)}
                  >
                    削除
                  </Button>
                  <span
                    className={active ? 'h-2 w-2 rounded-full bg-emerald-400' : 'h-2 w-2 rounded-full bg-slate-500'}
                    aria-label={active ? 'active' : 'available'}
                  />
                </div>
                <p className="truncate text-xs font-semibold text-white/60" title={profile.id}>
                  {profile.id}
                </p>
                {budget ? <p className="max-w-72 text-xs leading-snug text-white/60">{budget}</p> : null}
                {profile.startupFit ? (
                  <p className={profile.startupFit.status === 'insufficient' ? 'text-xs font-bold text-amber-300' : 'text-xs font-semibold text-white/60'}>
                    {profile.startupFit.detailJa}
                  </p>
                ) : null}
                {profile.deleteProtection?.protected ? (
                  <p className="text-xs font-semibold text-white/60">{profile.deleteProtection.reasonJa ?? '削除保護'}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {deletePreview ? (
        <div className="rounded-md border border-amber-400/30 bg-amber-500/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-white">{deletePreview.displayNameJa}</div>
              <div className="break-all text-xs font-semibold text-white/70">
                {deletePreview.resolvedStoragePath ?? deletePreview.storagePath ?? '保存先未取得'}
              </div>
            </div>
            <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-300">
              {deletePreview.canDelete ? `${deletePreview.sizeGiB ?? 0} GiB` : '削除保護'}
            </span>
          </div>
          {deletePreview.canDelete ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <Input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={deletePreview.requiredConfirmation}
                disabled={busy}
                aria-label="モデル保存先削除の確認入力"
              />
              <Button
                type="button"
                variant="danger"
                disabled={busy || deleteConfirmation !== deletePreview.requiredConfirmation}
                onClick={() => void executeDelete()}
              >
                保存先削除
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDeletePreview(null);
                  setDeleteConfirmation('');
                }}
              >
                取消
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {resultNote ? (
        <p
          role="status"
          className={
            resultNote.tone === 'success'
              ? 'text-xs text-emerald-300'
              : 'text-xs text-red-300'
          }
        >
          {resultNote.message}
        </p>
      ) : null}
    </div>
  );
}
