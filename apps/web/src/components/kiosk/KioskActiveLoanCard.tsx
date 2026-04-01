import { Button } from '../ui/Button';

import type { ActiveLoanCardKind, ActiveLoanListLines } from '../../features/kiosk/activeLoanListLines';

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

function activeLoanCardSurfaceClass(isOverdue: boolean, kind: ActiveLoanCardKind): string {
  if (isOverdue) {
    return 'border-2 border-red-700 bg-red-600 text-white shadow-lg';
  }
  if (kind === 'rigging') {
    return 'border-2 border-orange-700 bg-orange-500 text-white shadow-lg';
  }
  if (kind === 'instrument') {
    return 'border-2 border-purple-800 bg-purple-600 text-white shadow-lg';
  }
  return 'border-2 border-blue-700 bg-blue-500 text-white shadow-lg';
}

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
  onThumbnailClick
}: KioskActiveLoanCardProps) {
  const baseCardClass = activeLoanCardSurfaceClass(isOverdue, presentation.kind);

  return (
    <li className={`flex flex-col gap-3 rounded-lg border p-3 ${baseCardClass}`}>
      <div className="flex min-w-0 flex-1 gap-3">
        {thumbnailUrl ? (
          <div className="flex-shrink-0">
            <img
              src={thumbnailUrl}
              alt="撮影した写真"
              className="h-[72px] w-[72px] cursor-pointer rounded border border-white/10 object-cover hover:opacity-80"
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
        <div className="min-w-0 flex-1">
          {presentation.kind === 'instrument' ? (
            <>
              <div className="mb-1">
                <p className={`truncate text-sm font-bold ${isOverdue ? 'text-red-200' : 'text-white'}`}>
                  {presentation.primaryLine}
                </p>
              </div>
              <p className={`truncate text-base font-bold ${isOverdue ? 'text-red-200' : 'text-white'}`}>
                {presentation.nameLine}
              </p>
            </>
          ) : presentation.kind === 'rigging' ? (
            <>
              <div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className={`min-w-0 flex-1 truncate text-sm font-bold ${isOverdue ? 'text-red-200' : 'text-white'}`}>
                  {presentation.primaryLine}
                </p>
                {presentation.idNumLine != null ? (
                  <span className={`shrink-0 text-xs font-semibold ${isOverdue ? 'text-red-200' : 'text-white/85'}`}>
                    {presentation.idNumLine}
                  </span>
                ) : null}
              </div>
              <p className={`truncate text-base font-bold ${isOverdue ? 'text-red-200' : 'text-white'}`}>
                {presentation.nameLine}
              </p>
            </>
          ) : (
            <p className={`truncate text-base font-bold ${isOverdue ? 'text-red-200' : 'text-white'}`}>
              {presentation.primaryLine}
            </p>
          )}
          <p className={`mt-1 text-sm font-semibold ${isOverdue ? 'text-red-200' : 'text-white/95'}`}>
            {employeeDisplayName}
          </p>
          <p className={`mt-1 text-sm ${isOverdue ? 'text-red-200' : 'text-white/90'}`}>{presentation.clientLocationLine}</p>
          <p className={`mt-1 text-sm ${isOverdue ? 'text-red-200' : 'text-white/90'}`}>
            {borrowedAtDisplay}
            {isOverdue ? <span className="ml-2 font-bold text-red-200">⚠ 期限超過</span> : null}
          </p>
        </div>
      </div>
      <div className="flex w-full flex-row flex-wrap gap-2 justify-end">
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
          variant="ghost"
          className="h-auto px-3 py-1 text-sm font-semibold text-white/90 hover:bg-white/20 hover:text-white"
        >
          {cancelButtonLabel}
        </Button>
      </div>
    </li>
  );
}
