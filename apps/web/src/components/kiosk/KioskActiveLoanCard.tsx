import { resolveKioskLoanCardSurfaceTokens } from '@raspi-system/shared-types';

import { Button } from '../ui/Button';

import {
  kioskActiveLoanCardActionsRowClassName,
  kioskActiveLoanCardBodyColumnClassName,
  kioskActiveLoanCardMainRowClassName,
  kioskActiveLoanCardMetaLineClassName,
  kioskActiveLoanCardRootClassName,
  kioskActiveLoanCardThumbImgClassName,
  kioskActiveLoanCardThumbWrapClassName,
  kioskActiveLoanCardTruncOneLineClassName,
} from './kioskActiveLoanCardLayout';

import type { ActiveLoanListLines } from '../../features/kiosk/activeLoanListLines';

export type KioskActiveLoanCardProps = {
  presentation: ActiveLoanListLines;
  thumbnailUrl: string | null;
  photoUrl?: string | null;
  isOverdue: boolean;
  employeeDisplayName: string;
  borrowedAtDisplay: string;
  returnButtonLabel: string;
  cancelButtonLabel: string;
  actionsDisabled: boolean;
  onReturn: () => void;
  onCancel: () => void;
  onThumbnailClick?: (photoUrl: string) => void;
};

export function KioskActiveLoanCard({
  presentation,
  thumbnailUrl,
  photoUrl,
  isOverdue,
  employeeDisplayName,
  borrowedAtDisplay,
  returnButtonLabel,
  cancelButtonLabel,
  actionsDisabled,
  onReturn,
  onCancel,
  onThumbnailClick,
}: KioskActiveLoanCardProps) {
  const surface = resolveKioskLoanCardSurfaceTokens(presentation.kind, isOverdue);

  return (
    <li
      data-testid="kiosk-active-loan-card"
      className={kioskActiveLoanCardRootClassName}
      style={surface.root}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ background: surface.sheen.background }}
        aria-hidden
      />
      <div className={kioskActiveLoanCardMainRowClassName}>
        {thumbnailUrl ? (
          <div className={kioskActiveLoanCardThumbWrapClassName}>
            <img
              src={thumbnailUrl}
              alt="撮影した写真"
              className={kioskActiveLoanCardThumbImgClassName}
              onClick={() => {
                if (photoUrl && onThumbnailClick) {
                  onThumbnailClick(photoUrl);
                }
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        ) : null}
        <div className={kioskActiveLoanCardBodyColumnClassName}>
          {presentation.kind === 'instrument' ? (
            <>
              <div className="mb-1">
                <p className={`${kioskActiveLoanCardTruncOneLineClassName} text-sm font-bold`}>
                  {presentation.primaryLine}
                </p>
              </div>
              <p className={`${kioskActiveLoanCardTruncOneLineClassName} text-base font-bold`}>
                {presentation.nameLine ?? '計測機器'}
              </p>
            </>
          ) : presentation.kind === 'rigging' ? (
            <>
              <div className="mb-1 flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
                <p className={`min-w-0 flex-1 ${kioskActiveLoanCardTruncOneLineClassName} text-sm font-bold`}>
                  {presentation.primaryLine}
                </p>
                {presentation.idNumLine != null ? (
                  <span className="shrink-0 text-xs font-semibold text-white/85">{presentation.idNumLine}</span>
                ) : null}
              </div>
              <p className={`${kioskActiveLoanCardTruncOneLineClassName} text-base font-bold`}>
                {presentation.nameLine ?? '吊具'}
              </p>
            </>
          ) : (
            <p className={`${kioskActiveLoanCardTruncOneLineClassName} text-base font-bold`}>{presentation.primaryLine}</p>
          )}
          <p className={`${kioskActiveLoanCardMetaLineClassName} font-semibold`}>{employeeDisplayName}</p>
          <p className={kioskActiveLoanCardMetaLineClassName}>{presentation.clientLocationLine}</p>
          <p className={kioskActiveLoanCardMetaLineClassName}>
            <span>{borrowedAtDisplay}</span>
            {isOverdue ? <span className="ml-2 font-bold text-amber-100">⚠ 期限超過</span> : null}
          </p>
        </div>
      </div>
      <div className={kioskActiveLoanCardActionsRowClassName}>
        <Button
          onClick={onReturn}
          disabled={actionsDisabled}
          className="h-auto px-3 py-1 text-sm font-semibold"
        >
          {returnButtonLabel}
        </Button>
        <Button
          onClick={onCancel}
          disabled={actionsDisabled}
          variant="ghostOnDark"
          className="h-auto px-3 py-1 text-sm font-semibold hover:bg-white/20"
        >
          {cancelButtonLabel}
        </Button>
      </div>
    </li>
  );
}
