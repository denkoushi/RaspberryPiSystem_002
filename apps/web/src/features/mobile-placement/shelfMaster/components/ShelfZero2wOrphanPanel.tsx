import { shelfMasterButtonClass, shelfMasterTheme } from '../theme/shelfMasterTheme';

import type { OrphanZero2wDevice } from '../zero2wPreset/orphanZero2wDevices';

type Props = {
  orphans: OrphanZero2wDevice[];
  clearingDeviceId: string | null;
  presetApplyPending: boolean;
  onClear: (deviceId: string) => void;
};

export function ShelfZero2wOrphanPanel({
  orphans,
  clearingDeviceId,
  presetApplyPending,
  onClear
}: Props) {
  if (orphans.length === 0) {
    return null;
  }

  return (
    <div className={shelfMasterTheme.orphanAlert} role="status">
      <p className={shelfMasterTheme.orphanAlertTitle}>この区画の地図にない担当棚</p>
      <ul className="m-0 list-none space-y-0.5 p-0">
        {orphans.map((orphan) => {
          const clearing = clearingDeviceId === orphan.deviceId;
          const disabled = clearing || (presetApplyPending && !clearing);
          return (
            <li key={orphan.deviceId} className={shelfMasterTheme.orphanAlertRow}>
              <span className={shelfMasterTheme.orphanAlertLabel}>
                {orphan.deviceName} → {orphan.presetShelfCodeRaw}
              </span>
              <button
                type="button"
                className={shelfMasterButtonClass(false, {
                  enabled: !disabled,
                  variant: 'danger'
                })}
                disabled={disabled}
                onClick={() => onClear(orphan.deviceId)}
              >
                {clearing ? '解除中…' : 'スキャナ割当解除'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
