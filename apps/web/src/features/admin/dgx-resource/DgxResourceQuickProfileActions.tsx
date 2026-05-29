import { useState } from 'react';

import { getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { DGX_QUICK_START_MODEL_PROFILES } from './dgxResourceQuickProfileConfig';

import type {
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

  const startProfile = async (modelProfileId: string, label: string) => {
    const profile = selectable.find((p) => p.id === modelProfileId);
    if (!profile) {
      onControlUiError(`${label} は現在 DGX で利用できません（manifest / 実体パスを確認）`);
      return;
    }

    const ok = await confirm({
      title: `${label} を起動`,
      description: [
        `DGX の LocalLLM を model profile「${modelProfileId}」で起動します。`,
        '業務復帰シナリオは通さず、gateway へ /start のみ送ります。',
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
      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
        <h3 className="text-sm font-semibold text-white/90">モデルプロファイル起動</h3>
        <p className="mt-1 text-xs text-amber-200">
          {modelProfiles?.errorMessageJa ?? 'DGX model profiles を取得できないため、固定起動ボタンは無効です'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
      <h3 className="text-sm font-semibold text-white/90">モデルプロファイル起動</h3>
      <p className="text-xs leading-snug text-white/55">業務復帰を通さず、選択した profile で gateway /start のみ実行します。</p>
      <div className="flex flex-wrap gap-2">
        {DGX_QUICK_START_MODEL_PROFILES.map(({ modelProfileId, label }) => {
          const available = selectable.some((p) => p.id === modelProfileId);
          return (
            <Button
              key={modelProfileId}
              type="button"
              variant="secondary"
              disabled={busy || !available}
              aria-label={label}
              onClick={() => void startProfile(modelProfileId, label)}
            >
              {label}
            </Button>
          );
        })}
      </div>
      {resultNote ? (
        <p
          role="status"
          className={
            resultNote.tone === 'success'
              ? 'text-xs text-emerald-200'
              : 'text-xs text-red-300'
          }
        >
          {resultNote.message}
        </p>
      ) : null}
    </div>
  );
}
