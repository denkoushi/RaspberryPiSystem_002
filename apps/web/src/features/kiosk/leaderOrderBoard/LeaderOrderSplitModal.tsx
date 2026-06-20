import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deleteKioskProductionScheduleOrderSplits,
  fetchKioskProductionScheduleOrderSplits,
  replaceKioskProductionScheduleOrderSplits,
  type ProductionScheduleOrderSplitItem
} from '../../../api/client';
import { KioskDatePickerModal } from '../../../components/kiosk/KioskDatePickerModal';
import { KIOSK_DATE_PICKER_OVERLAY_Z_ABOVE_LEFT_STACK } from '../../../hooks/kioskRevealUi';

import type { LeaderBoardRow } from './types';

export type LeaderOrderSplitModalProps = {
  open: boolean;
  row: LeaderBoardRow | null;
  targetDeviceScopeKey?: string;
  onClose: () => void;
  onSaved: () => void;
};

export type DraftSplitItem = {
  splitNo: number;
  splitQuantity: string;
  dueDate: string;
  plannedStartDate: string;
  plannedEndDate: string;
  orderNumber: string;
};

const emptyDraft = (splitNo: number): DraftSplitItem => ({
  splitNo,
  splitQuantity: '',
  dueDate: '',
  plannedStartDate: '',
  plannedEndDate: '',
  orderNumber: ''
});

export const MAX_SPLIT_DRAFTS = 50;

export function sumSplitDraftQuantities(drafts: ReadonlyArray<Pick<DraftSplitItem, 'splitQuantity'>>): number {
  return drafts.reduce((sum, item) => {
    const n = Number(item.splitQuantity);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

export function validateSplitDrafts(params: {
  drafts: readonly DraftSplitItem[];
  plannedQuantity: number | null;
  maxDrafts?: number;
}): string | null {
  const maxDrafts = params.maxDrafts ?? MAX_SPLIT_DRAFTS;
  if (params.plannedQuantity == null) return '指示数が未設定のため分割できません';
  if (params.drafts.length > maxDrafts) {
    return `分割片は最大${maxDrafts}件までです`;
  }

  const usedOrderNumbers = new Set<number>();
  for (const item of params.drafts) {
    const q = Number(item.splitQuantity);
    if (!Number.isInteger(q) || q <= 0) return '各分割片の数量は正の整数で入力してください';
    if (item.orderNumber.trim().length > 0) {
      const order = Number(item.orderNumber);
      if (!Number.isInteger(order) || order < 1 || order > 10) {
        return '手動順番は1〜10の整数で入力してください';
      }
      if (usedOrderNumbers.has(order)) {
        return '手動順番が重複しています';
      }
      usedOrderNumbers.add(order);
    }
  }

  const quantitySum = sumSplitDraftQuantities(params.drafts);
  if (quantitySum !== params.plannedQuantity) {
    return `分割数量の合計(${quantitySum})が指示数(${params.plannedQuantity})と一致しません`;
  }
  return null;
}

export function LeaderOrderSplitModal({
  open,
  row,
  targetDeviceScopeKey,
  onClose,
  onSaved
}: LeaderOrderSplitModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plannedQuantity, setPlannedQuantity] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<DraftSplitItem[]>([emptyDraft(1), emptyDraft(2)]);
  const [dueDatePickerIndex, setDueDatePickerIndex] = useState<number | null>(null);

  const sourceRowId = row?.sourceRowId ?? row?.id ?? '';

  const loadSplits = useCallback(async () => {
    if (!open || !sourceRowId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKioskProductionScheduleOrderSplits(sourceRowId, {
        ...(targetDeviceScopeKey ? { targetDeviceScopeKey } : {})
      });
      setPlannedQuantity(data.plannedQuantity);
      if (data.splits.length > 0) {
        setDrafts(
          data.splits.map((split) => ({
            splitNo: split.splitNo,
            splitQuantity: String(split.splitQuantity),
            dueDate: split.dueDate ?? '',
            plannedStartDate: split.plannedStartDate ?? '',
            plannedEndDate: split.plannedEndDate ?? '',
            orderNumber: split.orderNumber != null ? String(split.orderNumber) : ''
          }))
        );
      } else {
        setDrafts([emptyDraft(1), emptyDraft(2)]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '分割情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [open, sourceRowId, targetDeviceScopeKey]);

  useEffect(() => {
    void loadSplits();
  }, [loadSplits]);

  const validationMessage = useMemo(() => {
    return validateSplitDrafts({ drafts, plannedQuantity });
  }, [drafts, plannedQuantity]);

  const updateDraft = (index: number, patch: Partial<DraftSplitItem>) => {
    setDrafts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addDraft = () => {
    setDrafts((prev) => {
      if (prev.length >= MAX_SPLIT_DRAFTS) return prev;
      return [...prev, emptyDraft(prev.length + 1)];
    });
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next.map((item, i) => ({ ...item, splitNo: i + 1 }));
    });
  };

  const handleSave = async () => {
    if (!row || validationMessage) {
      setError(validationMessage);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const items = drafts.map((item) => ({
        splitNo: item.splitNo,
        splitQuantity: Number(item.splitQuantity),
        dueDate: item.dueDate.trim().length > 0 ? item.dueDate.trim() : null,
        plannedStartDate: item.plannedStartDate.trim().length > 0 ? item.plannedStartDate.trim() : null,
        plannedEndDate: item.plannedEndDate.trim().length > 0 ? item.plannedEndDate.trim() : null,
        orderNumber: item.orderNumber.trim().length > 0 ? Number(item.orderNumber) : null
      }));
      await replaceKioskProductionScheduleOrderSplits(sourceRowId, {
        resourceCd: row.resourceCd,
        items,
        ...(targetDeviceScopeKey ? { targetDeviceScopeKey } : {})
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '分割の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleClearSplits = async () => {
    if (!sourceRowId) return;
    if (!window.confirm('この行の分割をすべて解除します。よろしいですか？')) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteKioskProductionScheduleOrderSplits(sourceRowId, {
        ...(targetDeviceScopeKey ? { targetDeviceScopeKey } : {})
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '分割の解除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (!open || !row) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-600 bg-slate-900 text-slate-100 shadow-xl">
        <div className="border-b border-slate-700 px-4 py-3">
          <h2 className="text-lg font-semibold">指示数の分割</h2>
          <p className="mt-1 text-sm text-slate-300">
            {row.fhinmei || row.fhincd} / 指示数: {plannedQuantity ?? '—'}
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loading ? <p className="text-sm text-slate-300">読み込み中…</p> : null}
          {drafts.map((item, index) => (
            <div key={`split-draft-${item.splitNo}`} className="rounded border border-slate-700 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">分割 {item.splitNo}</span>
                {drafts.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs text-rose-300 hover:text-rose-200"
                    onClick={() => removeDraft(index)}
                  >
                    削除
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs">
                  数量
                  <input
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1"
                    inputMode="numeric"
                    value={item.splitQuantity}
                    onChange={(e) => updateDraft(index, { splitQuantity: e.target.value })}
                  />
                </label>
                <label className="text-xs">
                  納期
                  <button
                    type="button"
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-left"
                    onClick={() => setDueDatePickerIndex(index)}
                  >
                    {item.dueDate.trim().length > 0 ? item.dueDate : '未設定'}
                  </button>
                </label>
                <label className="text-xs">
                  手動順番
                  <input
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1"
                    inputMode="numeric"
                    value={item.orderNumber}
                    onChange={(e) => updateDraft(index, { orderNumber: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="rounded border border-dashed border-slate-600 px-3 py-2 text-sm text-cyan-200 disabled:opacity-50"
            onClick={addDraft}
            disabled={drafts.length >= MAX_SPLIT_DRAFTS}
          >
            + 分割片を追加
          </button>
          {validationMessage ? <p className="text-sm text-amber-300">{validationMessage}</p> : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-700 px-4 py-3">
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-2 text-sm"
            onClick={() => void handleClearSplits()}
            disabled={saving}
          >
            分割を解除
          </button>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-slate-600 px-3 py-2 text-sm" onClick={onClose}>
              キャンセル
            </button>
            <button
              type="button"
              className="rounded bg-cyan-600 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
              disabled={saving || Boolean(validationMessage)}
              onClick={() => void handleSave()}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {dueDatePickerIndex != null ? (
        <KioskDatePickerModal
          isOpen
          value={drafts[dueDatePickerIndex]?.dueDate ?? ''}
          onCancel={() => setDueDatePickerIndex(null)}
          onCommit={(value) => {
            updateDraft(dueDatePickerIndex, { dueDate: value });
            setDueDatePickerIndex(null);
          }}
          overlayZIndex={KIOSK_DATE_PICKER_OVERLAY_Z_ABOVE_LEFT_STACK}
        />
      ) : null}
    </div>
  );
}

export function mapSplitItemsToDrafts(splits: ProductionScheduleOrderSplitItem[]): DraftSplitItem[] {
  return splits.map((split) => ({
    splitNo: split.splitNo,
    splitQuantity: String(split.splitQuantity),
    dueDate: split.dueDate ?? '',
    plannedStartDate: split.plannedStartDate ?? '',
    plannedEndDate: split.plannedEndDate ?? '',
    orderNumber: split.orderNumber != null ? String(split.orderNumber) : ''
  }));
}
