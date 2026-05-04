import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { putMobilePlacementHaizenTargetPresetShelf } from '../../api/client';
import { mpKioskTheme } from '../../features/mobile-placement/ui/mobilePlacementKioskTheme';
import { useHaizenTargetDevices } from '../../features/mobile-placement/useHaizenTargetDevices';
import { useRegisteredShelves } from '../../features/mobile-placement/useRegisteredShelves';

function formatDeviceSubLine(location: string | null, lastSeenAt: string | null): string {
  const parts: string[] = [];
  if (location && location.trim().length > 0) {
    parts.push(location.trim());
  }
  if (lastSeenAt) {
    parts.push(new Date(lastSeenAt).toLocaleString('ja-JP'));
  }
  return parts.join(' / ');
}

export function KioskMobileZero2wAssignmentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const targetsQuery = useHaizenTargetDevices();
  const shelvesQuery = useRegisteredShelves();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedShelfCode, setSelectedShelfCode] = useState<string>('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const devices = useMemo(() => targetsQuery.data?.devices ?? [], [targetsQuery.data?.devices]);
  const structuredShelves = useMemo(
    () => (shelvesQuery.data?.shelves ?? []).filter((shelf) => shelf.isStructured),
    [shelvesQuery.data?.shelves]
  );
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? null;

  useEffect(() => {
    if (devices.length === 0) {
      setSelectedDeviceId('');
      return;
    }
    if (!selectedDeviceId || !devices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    setSelectedShelfCode(selectedDevice?.shelfCodeRaw ?? '');
    setSaveError(null);
  }, [selectedDevice?.id, selectedDevice?.shelfCodeRaw]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDevice || selectedShelfCode.trim().length === 0) {
        return;
      }
      await putMobilePlacementHaizenTargetPresetShelf({
        clientDeviceId: selectedDevice.id,
        shelfCodeRaw: selectedShelfCode
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'haizen-target-devices'] });
    },
    onError: (error: unknown) => {
      setSaveError(error instanceof Error ? error.message : '保存に失敗しました');
    }
  });

  const canSave =
    selectedDevice != null &&
    selectedShelfCode.trim().length > 0 &&
    selectedShelfCode !== selectedDevice.shelfCodeRaw &&
    !saveMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-900">
      <div className="flex items-center gap-2 px-3 pt-2">
        <button type="button" className={mpKioskTheme.partSearchButton} onClick={() => navigate('/kiosk/mobile-placement')}>
          戻る
        </button>
        <div className={`${mpKioskTheme.assignmentSummaryCard} min-w-0 flex-1`}>
          <div className={mpKioskTheme.assignmentSummaryLabel}>Zero2W担当棚設定</div>
          <div className={mpKioskTheme.assignmentSummaryValue}>
            {selectedDevice?.name ?? (targetsQuery.isLoading ? '読込中…' : '端末なし')}
          </div>
        </div>
        <button
          type="button"
          className={mpKioskTheme.orderSubmitButton}
          disabled={!canSave}
          onClick={() => {
            setSaveError(null);
            void saveMutation.mutateAsync();
          }}
        >
          {saveMutation.isPending ? '保存中…' : '保存'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 pb-3 pt-3">
        {targetsQuery.isError ? <p className="text-center text-sm font-bold text-red-300">端末一覧の取得に失敗しました</p> : null}
        {shelvesQuery.isError ? <p className="text-center text-sm font-bold text-red-300">棚一覧の取得に失敗しました</p> : null}
        {saveError ? <p className="text-center text-sm font-bold text-red-300">{saveError}</p> : null}

        <section className={`${mpKioskTheme.assignmentPanelRoot} shrink-0`} aria-label="Zero2W一覧">
          <div className={mpKioskTheme.shelfPanelHeaderRow}>
            <div className="text-sm font-extrabold text-slate-100">Zero2W</div>
            {selectedDevice ? (
              <div className="ml-auto text-sm font-bold text-amber-300">
                現在棚 {selectedDevice.shelfCodeRaw ?? '未設定'}
              </div>
            ) : null}
          </div>
          {targetsQuery.isLoading ? (
            <p className="text-sm font-bold text-slate-300">読込中…</p>
          ) : devices.length === 0 ? (
            <p className="text-sm font-bold text-slate-300">対象端末なし</p>
          ) : (
            <div className={mpKioskTheme.assignmentDeviceGrid}>
              {devices.map((device) => {
                const selected = device.id === selectedDeviceId;
                const subLine = formatDeviceSubLine(device.location, device.lastSeenAt);
                return (
                  <button
                    key={device.id}
                    type="button"
                    className={`${mpKioskTheme.assignmentDeviceButton} ${
                      selected ? mpKioskTheme.assignmentDeviceButtonOn : ''
                    }`}
                    onClick={() => setSelectedDeviceId(device.id)}
                  >
                    <div className={mpKioskTheme.assignmentDeviceName}>{device.name}</div>
                    {subLine ? <div className={mpKioskTheme.assignmentDeviceMeta}>{subLine}</div> : null}
                    <div className={mpKioskTheme.assignmentDeviceShelf}>棚 {device.shelfCodeRaw ?? '未設定'}</div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className={`${mpKioskTheme.shelfPanelRoot} min-h-0`} aria-label="棚一覧">
          <div className={mpKioskTheme.shelfPanelHeaderRow}>
            <div className="text-sm font-extrabold text-white">棚番</div>
            <div className="ml-auto text-sm font-bold text-amber-300">{selectedShelfCode || '未選択'}</div>
          </div>
          {shelvesQuery.isLoading ? (
            <p className="text-sm font-bold text-slate-300">読込中…</p>
          ) : (
            <div className={`${mpKioskTheme.shelfListShell} min-h-0`}>
              <div className={`${mpKioskTheme.shelfChipGrid} max-h-none flex-1`}>
                {structuredShelves.map((shelf) => {
                  const selected = shelf.shelfCodeRaw === selectedShelfCode;
                  const [prefix, number] = shelf.shelfCodeRaw.split(/-(?=[^-]+$)/);
                  return (
                    <button
                      key={shelf.shelfCodeRaw}
                      type="button"
                      className={`${mpKioskTheme.shelfChipButton} ${selected ? mpKioskTheme.shelfChipButtonOn : ''}`}
                      onClick={() => setSelectedShelfCode(shelf.shelfCodeRaw)}
                    >
                      <span className={mpKioskTheme.shelfChipPrefix}>{prefix}</span>
                      <span className={mpKioskTheme.shelfChipNum}>{number ?? ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
