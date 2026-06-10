import {
  DEFAULT_KIOSK_HEADER_TAB_ORDER,
  normalizeKioskHeaderTabOrder,
  type KioskReorderableHeaderTabId
} from '@raspi-system/shared-types';
import { useEffect, useMemo, useState } from 'react';

import { useKioskNavTabOrderSettings, useUpdateKioskNavTabOrderSettings } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { KIOSK_HEADER_TAB_LABELS } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderTabLabels';

function moveTabOrder(tabOrder: KioskReorderableHeaderTabId[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= tabOrder.length) {
    return tabOrder;
  }
  const next = [...tabOrder];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function KioskSettingsPage() {
  const settingsQuery = useKioskNavTabOrderSettings();
  const updateMutation = useUpdateKioskNavTabOrderSettings();
  const [tabOrder, setTabOrder] = useState<KioskReorderableHeaderTabId[]>([...DEFAULT_KIOSK_HEADER_TAB_ORDER]);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const serverTabOrder = settingsQuery.data?.settings.tabOrder;
  const normalizedServerTabOrder = useMemo(
    () => normalizeKioskHeaderTabOrder(serverTabOrder ?? DEFAULT_KIOSK_HEADER_TAB_ORDER),
    [serverTabOrder]
  );

  const isDirty = useMemo(() => {
    const normalizedDraft = normalizeKioskHeaderTabOrder(tabOrder);
    return normalizedDraft.join('\0') !== normalizedServerTabOrder.join('\0');
  }, [normalizedServerTabOrder, tabOrder]);

  useEffect(() => {
    if (!serverTabOrder || hasUserEdited) return;
    setTabOrder(normalizedServerTabOrder);
  }, [serverTabOrder, normalizedServerTabOrder, hasUserEdited]);

  const handleMoveTab = (index: number, direction: -1 | 1) => {
    setHasUserEdited(true);
    setTabOrder((current) => moveTabOrder(current, index, direction));
  };

  const handleSave = async () => {
    setMessage(null);
    try {
      const result = await updateMutation.mutateAsync({ tabOrder });
      setTabOrder(normalizeKioskHeaderTabOrder(result.settings.tabOrder));
      setHasUserEdited(false);
      setMessage({ text: 'キオスクヘッダーのタブ順を保存しました。', tone: 'success' });
    } catch {
      setMessage({ text: '保存に失敗しました。', tone: 'error' });
    }
  };

  const handleResetDraft = () => {
    setTabOrder(normalizedServerTabOrder);
    setHasUserEdited(false);
    setMessage(null);
  };

  const handleResetDefault = () => {
    setHasUserEdited(true);
    setTabOrder([...DEFAULT_KIOSK_HEADER_TAB_ORDER]);
    setMessage(null);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold">キオスク表示設定</h2>
        <p className="mt-1 text-sm text-white/70">
          キオスクヘッダーの主要タブ順を全端末共通で設定します。サイネージ・管理・お問い合わせは固定です。
        </p>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        {settingsQuery.isLoading ? <p className="text-sm text-slate-600">読込中…</p> : null}
        {settingsQuery.isError ? (
          <p className="text-sm text-red-600">設定の取得に失敗しました。</p>
        ) : null}
        <ul className="grid gap-2">
          {tabOrder.map((tabId, index) => (
            <li
              key={tabId}
              className="flex items-center justify-between gap-3 rounded border border-white/10 bg-slate-900/60 px-3 py-2 text-white"
            >
              <div>
                <p className="font-semibold text-white">{KIOSK_HEADER_TAB_LABELS[tabId]}</p>
                <p className="text-xs text-white/50">{tabId}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghostOnDark"
                  disabled={index === 0 || updateMutation.isPending}
                  onClick={() => handleMoveTab(index, -1)}
                >
                  上へ
                </Button>
                <Button
                  type="button"
                  variant="ghostOnDark"
                  disabled={index === tabOrder.length - 1 || updateMutation.isPending}
                  onClick={() => handleMoveTab(index, 1)}
                >
                  下へ
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void handleSave()} disabled={!isDirty || updateMutation.isPending}>
            保存
          </Button>
          <Button type="button" variant="ghost" onClick={handleResetDraft} disabled={!isDirty || updateMutation.isPending}>
            変更を戻す
          </Button>
          <Button type="button" variant="ghost" onClick={handleResetDefault} disabled={updateMutation.isPending}>
            既定順に戻す
          </Button>
        </div>
        {message ? (
          <p className={`text-sm ${message.tone === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
            {message.text}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
