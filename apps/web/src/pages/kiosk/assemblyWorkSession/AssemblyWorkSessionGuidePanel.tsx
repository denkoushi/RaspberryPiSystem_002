import { Button } from '../../../components/ui/Button';

import type { BusinessHermesGuideResponse } from '../../../api/domains/assembly';

type Props = {
  displayedHermesGuide: BusinessHermesGuideResponse | null;
  hermesGuideBusy: boolean;
  sessionActive: boolean;
  requestHermesGuide: () => Promise<void>;
};

export function AssemblyWorkSessionGuidePanel({
  displayedHermesGuide,
  hermesGuideBusy,
  sessionActive,
  requestHermesGuide
}: Props) {
  return (
    <div className="mt-2 rounded border border-cyan-300/20 bg-cyan-950/20 p-2" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-cyan-100">作業案内</span>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-10 !px-3 text-sm"
          disabled={hermesGuideBusy || !sessionActive}
          onClick={() => void requestHermesGuide()}
        >
          {hermesGuideBusy ? '確認中…' : 'Hermesに確認'}
        </Button>
      </div>
      {displayedHermesGuide?.status === 'ready' && displayedHermesGuide.message ? (
        <p className="mt-2 text-sm text-cyan-50">{displayedHermesGuide.message}</p>
      ) : null}
      {displayedHermesGuide?.status === 'unknown' ? (
        <p className="mt-2 text-xs text-amber-100">根拠を確認できないため案内を表示できません。画面の手順を確認してください。</p>
      ) : null}
      {displayedHermesGuide?.status === 'unavailable' ? (
        <p className="mt-2 text-xs text-white/60">案内は現在利用できません。作業画面はそのまま使用できます。</p>
      ) : null}
      {displayedHermesGuide?.status === 'ready' && displayedHermesGuide.evidence[0] ? (
        <p className="mt-1 text-[0.7rem] text-white/55">
          根拠: {displayedHermesGuide.evidence[0].documentTitle} / {displayedHermesGuide.evidence[0].pageIndex + 1}ページ
        </p>
      ) : null}
    </div>
  );
}
