import { useState } from 'react';

import { getApiErrorMessage } from '../../../api/errors';
import { useSignageScheduleMutations } from '../../../api/hooks';
import { useConfirm } from '../../../contexts/ConfirmContext';

import {
  ALL_DAYS,
  ALWAYS_END,
  ALWAYS_START,
  isAlwaysSchedule,
  planRemoveFromScreen,
  validateQuickWhen,
  type PlaylistItem,
  type QuickWhen,
} from './playlistModel';
import { WhenEditor } from './WhenEditor';

import type { SignageSchedule } from '../../../api/client';

const KIND_LABEL: Record<PlaylistItem['kind'], string> = { web_page: 'ページ', data: 'データ', pdf: 'ファイル', chat: 'Chat' };

function whenOf(schedule: SignageSchedule): QuickWhen {
  return isAlwaysSchedule(schedule)
    ? { always: true, dayOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }
    : { always: false, dayOfWeek: schedule.dayOfWeek, startTime: schedule.startTime, endTime: schedule.endTime };
}

/**
 * 選んだ画面で「順番に映すもの」。行を押すと、その場で時間を決められる。
 * 細かい設定（左右分割や種類ごとの設定）は「詳しく」から従来の編集パネルを開く。
 */
export function PlaylistPanel({
  items,
  schedules,
  clientKey,
  clientName,
  switchSeconds,
  justAddedId,
  onAdd,
  onAdvanced,
}: {
  items: PlaylistItem[];
  schedules: SignageSchedule[];
  clientKey: string | null;
  clientName: string | null;
  switchSeconds: number;
  justAddedId: string | null;
  onAdd: () => void;
  onAdvanced: (schedule: SignageSchedule) => void;
}) {
  const confirm = useConfirm();
  const { update, remove } = useSignageScheduleMutations();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuickWhen | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (schedule: SignageSchedule) => {
    setError(null);
    if (openId === schedule.id) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    setOpenId(schedule.id);
    setDraft(whenOf(schedule));
  };

  const saveWhen = async (schedule: SignageSchedule) => {
    if (!draft) return;
    const problem = validateQuickWhen(draft);
    setError(problem);
    if (problem) return;
    try {
      await update.mutateAsync({
        id: schedule.id,
        payload: {
          dayOfWeek: draft.always ? ALL_DAYS : [...draft.dayOfWeek].sort((a, b) => a - b),
          startTime: draft.always ? ALWAYS_START : draft.startTime,
          endTime: draft.always ? ALWAYS_END : draft.endTime,
        },
      });
      setOpenId(null);
      setDraft(null);
    } catch (err) {
      setError(getApiErrorMessage(err, '保存できませんでした'));
    }
  };

  const handleRemove = async (schedule: SignageSchedule) => {
    if (!clientKey) return;
    const plan = planRemoveFromScreen(schedule, clientKey);
    const ok = await confirm({
      title: `「${schedule.name}」を外しますか？`,
      description:
        plan.action === 'delete' && plan.affectsAllScreens
          ? 'すべての画面に出しているので、すべての画面から外れます。'
          : `${clientName ?? 'この画面'} から外します。`,
      confirmLabel: '外す',
      tone: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      if (plan.action === 'delete') await remove.mutateAsync(schedule.id);
      else await update.mutateAsync({ id: schedule.id, payload: { targetClientKeys: plan.targetClientKeys } });
    } catch (err) {
      setError(getApiErrorMessage(err, '外せませんでした'));
    }
  };

  return (
    <section aria-label="順番に映すもの" className="sh-panel sh-col sh-playlist">
      <div className="sh-row-between" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>順番に映すもの</h2>
        <span className="sh-mono" style={{ fontSize: 12, color: 'var(--sh-muted)' }}>
          {items.length} 件 · {switchSeconds}秒ずつ
        </span>
      </div>

      <div className="sh-col sh-playlist-rows">
        {items.length === 0 && (
          <p className="sh-hint" style={{ margin: 0 }}>
            まだ何もありません。「映す」から追加してください。
          </p>
        )}
        {items.map((item) => {
          const schedule = schedules.find((entry) => entry.id === item.scheduleId);
          if (!schedule) return null;
          const isOpen = openId === item.scheduleId;
          return (
            <div key={item.scheduleId} className="sh-pl-row" data-onair={item.isOnAir} data-new={justAddedId === item.scheduleId} data-open={isOpen}>
              <div className="sh-pl-main">
                <button type="button" className="sh-pl-open" aria-expanded={isOpen} onClick={() => open(schedule)}>
                  <span className="sh-pl-thumb" style={{ background: `var(--sh-kind-${item.kind})` }} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="sh-pl-name">{item.name}</span>
                    <span className="sh-pl-meta">
                      {justAddedId === item.scheduleId ? (
                        <span style={{ color: 'var(--sh-kind-web_page)' }}>追加しました · 次の切り替えで映ります</span>
                      ) : (
                        <>
                          {KIND_LABEL[item.kind]}
                          {item.isOnAir ? ' · いま映っています' : ''}
                          {item.targetsAllScreens ? '' : ' · この画面だけ'}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="sh-when" data-limited={!item.isAlways}>
                    {item.whenLabel}
                  </span>
                </button>
                <button type="button" className="sh-pl-remove" aria-label={`${item.name} を外す`} onClick={() => void handleRemove(schedule)}>
                  ×
                </button>
              </div>
              {isOpen && draft && (
                <div className="sh-pl-edit">
                  <WhenEditor value={draft} onChange={setDraft} idPrefix={`sh-pl-${item.scheduleId}`} />
                  {error && (
                    <p className="sh-error" role="alert" style={{ margin: 0 }}>
                      {error}
                    </p>
                  )}
                  <div className="sh-row-between">
                    <button type="button" className="sh-mini-btn" onClick={() => onAdvanced(schedule)}>
                      詳しく
                    </button>
                    <button type="button" className="sh-btn sh-btn-light" style={{ minHeight: 36 }} onClick={() => void saveWhen(schedule)} disabled={update.isPending}>
                      {update.isPending ? '保存中…' : '保存'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!openId && error && (
        <p className="sh-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <button type="button" className="sh-pl-add" onClick={onAdd}>
        ＋ 映すものを追加
      </button>
    </section>
  );
}
