import clsx from 'clsx';

import { shelfMasterButtonClass, shelfMasterTheme } from '../theme/shelfMasterTheme';

import type { Zero2wAssignmentFlowGates } from '../flow/zero2wAssignmentFlow';

type Zero2wDevice = {
  id: string;
  name: string;
  shelfCodeRaw: string | null;
};

type Props = {
  gates: Zero2wAssignmentFlowGates;
  devices: Zero2wDevice[];
  selectedDeviceId: string;
  selectedShelf: string;
  savePending: boolean;
  onSelectDevice: (deviceId: string, currentShelf: string) => void;
  onSave: () => void;
};

export function ShelfZero2wAssignmentRail({
  gates,
  devices,
  selectedDeviceId,
  selectedShelf,
  savePending,
  onSelectDevice,
  onSave
}: Props) {
  const mapShelfFlow = gates.emphasize === 'mapShelf' && gates.mapShelfPick;

  return (
    <div
      className={clsx(
        shelfMasterTheme.dockRight,
        mapShelfFlow && 'rounded-lg ring-2 ring-sky-400/70 ring-offset-1 ring-offset-slate-900'
      )}
    >
      <p className={shelfMasterTheme.dockRightLabel}>棚番パイ（3列 · 3行表示 · 以降スクロール）</p>
      <div className={shelfMasterTheme.piCardsGrid}>
        {devices.map((d) => {
          const on = d.id === selectedDeviceId;
          const sub =
            on && selectedShelf.length > 0
              ? selectedShelf
              : d.shelfCodeRaw != null && d.shelfCodeRaw.length > 0
                ? d.shelfCodeRaw
                : '未設定';
          return (
            <button
              key={d.id}
              type="button"
              disabled={!gates.deviceSelect}
              className={clsx(shelfMasterTheme.piCard, on && shelfMasterTheme.piCardOn, !gates.deviceSelect && shelfMasterTheme.ctlOff)}
              onClick={() => onSelectDevice(d.id, d.shelfCodeRaw ?? '')}
              aria-pressed={on}
            >
              <div className={shelfMasterTheme.piCardName}>{d.name}</div>
              <div className={shelfMasterTheme.piCardSub}>{sub}</div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={clsx(
          shelfMasterTheme.piSaveBtn,
          shelfMasterButtonClass(true, {
            enabled: gates.save,
            flow: gates.emphasize === 'save',
            variant: 'primary'
          }),
          (!gates.save || savePending) && shelfMasterTheme.ctlOff
        )}
        disabled={!gates.save || savePending}
        onClick={onSave}
      >
        担当棚を保存
      </button>
    </div>
  );
}
