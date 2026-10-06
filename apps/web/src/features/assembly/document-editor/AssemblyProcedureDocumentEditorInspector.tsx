import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Input } from '../../../components/ui/Input';

import {
  convertOverlayShapeKind,
  normalizeOverlayBBox,
  updateOverlayBBox
} from './assemblyDocumentEditorDraft';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

function numberValue(value: string, fallback: number): number {
  if (value.trim() === '') return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ratioToPercent(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

export function percentToRatio(percent: number): number {
  return percent / 100;
}

export function AssemblyProcedureDocumentEditorInspector({
  element,
  onUpdate,
  onDuplicate,
  onClose,
  onDelete,
  onBringForward,
  onSendBackward,
  onUploadImage,
  onRefetchTextCandidates,
  readOnly = false,
  busy = false
}: {
  element: AssemblyProcedureOverlayElement | null;
  onDuplicate?: () => void;
  onClose?: () => void;
  onUpdate: (element: AssemblyProcedureOverlayElement) => void;
  onDelete: () => void;
  onBringForward: (id: string) => void;
  onSendBackward: (id: string) => void;
  onUploadImage: (file: File) => void;
  onRefetchTextCandidates: () => void;
  readOnly?: boolean;
  busy?: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  if (!element) return null;

  const patch = (next: Partial<AssemblyProcedureOverlayElement>) => onUpdate({ ...element, ...next } as AssemblyProcedureOverlayElement);
  const patchTextStyle = (next: NonNullable<Extract<AssemblyProcedureOverlayElement, { kind: 'TEXT' }>['style']>) => {
    if (element.kind !== 'TEXT') return;
    patch({ style: { ...(element.style ?? {}), ...next } });
  };
  const bbox = element.bbox;

  return (
    <aside className="flex min-h-0 w-full flex-col gap-3 text-[15px] text-[#eef3f6]" aria-label="オーバーレイ編集" aria-disabled={readOnly}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-black">{element.kind === 'TEXT' ? '文章' : element.kind === 'IMAGE' ? '画像' : '図形・記号'}</h2>
        <button type="button" aria-label="属性を閉じる" onClick={onClose} className="h-11 w-11 rounded-lg border border-[#344252] text-[#9fadb9]">✕</button>
      </div>
      <fieldset disabled={readOnly} className="contents">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghostOnDark" className="min-h-11" onClick={onDuplicate}>複製</Button>
        <Button type="button" variant="danger" className="min-h-11 !px-2 text-xs" onClick={() => setDeleteOpen(true)}>
          削除
        </Button>
      </div>

      {element.kind === 'TEXT' ? (
        <fieldset className="grid gap-1 font-semibold">
          <legend>文章</legend>
          <textarea
            data-kiosk-sop-target="assembly-document-editor-text-value"
            value={element.text}
            onChange={(event) => patch({ text: event.target.value })}
            className="min-h-24 min-w-0 rounded border border-slate-500 bg-white px-2 py-2 text-lg text-slate-900"
          />
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 !px-2 text-xs"
            disabled={busy}
            onClick={onRefetchTextCandidates}
          >
            この範囲で候補を再取得
          </Button>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="grid gap-0.5 text-sm font-semibold">
              文字サイズ比率 (%)
              <Input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={ratioToPercent(element.style?.fontSizeRatio ?? 0.025)}
                className="min-h-11 min-w-0 !px-2 text-lg"
                onChange={(event) => patchTextStyle({ fontSizeRatio: clamp(percentToRatio(numberValue(event.target.value, (element.style?.fontSizeRatio ?? 0.025) * 100)), 0.005, 0.2) })}
              />
            </label>
            <label className="grid gap-0.5 text-sm font-semibold">
              文字色
              <Input
                type="color"
                value={element.style?.color ?? '#0f172a'}
                className="min-h-11 min-w-0 !p-1 text-lg"
                onChange={(event) => patchTextStyle({ color: event.target.value })}
              />
            </label>
            <label className="grid gap-0.5 text-sm font-semibold">
              太さ
              <select
                value={element.style?.fontWeight ?? 'normal'}
                onChange={(event) => patchTextStyle({ fontWeight: event.target.value as 'normal' | 'bold' })}
                className="min-h-11 min-w-0 rounded border border-slate-500 bg-white px-2 text-lg text-slate-900"
              >
                <option value="normal">標準</option>
                <option value="bold">太字</option>
              </select>
            </label>
            <label className="grid gap-0.5 text-sm font-semibold">
              揃え
              <select
                value={element.style?.align ?? 'start'}
                onChange={(event) => patchTextStyle({ align: event.target.value as 'start' | 'center' | 'end' })}
                className="min-h-11 min-w-0 rounded border border-slate-500 bg-white px-2 text-lg text-slate-900"
              >
                <option value="start">左</option>
                <option value="center">中央</option>
                <option value="end">右</option>
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}

      {element.kind === 'IMAGE' ? (
        <fieldset className="grid gap-1 font-semibold">
          <legend>画像asset ID</legend>
          <Input
            data-kiosk-sop-target="assembly-document-editor-image-asset"
            value={element.assetId}
            onChange={(event) => patch({ assetId: event.target.value })}
            placeholder="asset ID"
            className="min-h-11 min-w-0 !px-2 text-lg"
          />
          <input
            type="file"
            accept="image/*"
            className="min-h-11 w-full min-w-0 rounded border border-slate-500 bg-white px-2 py-2 text-lg text-slate-900"
            aria-label="画像ファイルをアップロード"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadImage(file);
              event.currentTarget.value = '';
            }}
          />
          <label className="grid gap-0.5 text-sm font-semibold">
            画像の収まり
            <select
              value={element.objectFit ?? 'contain'}
              onChange={(event) => patch({ objectFit: event.target.value as typeof element.objectFit })}
              className="min-h-11 min-w-0 rounded border border-slate-500 bg-white px-2 text-lg text-slate-900"
            >
              <option value="contain">全体表示</option>
              <option value="cover">枠いっぱい</option>
              <option value="fill">引き伸ばす</option>
            </select>
          </label>
        </fieldset>
      ) : null}

      {element.kind === 'SHAPE' ? (
        <fieldset className="grid gap-1 font-semibold">
          <legend>図形</legend>
          <select
            data-kiosk-sop-target="assembly-document-editor-shape-kind"
            value={element.shape}
            onChange={(event) => onUpdate(convertOverlayShapeKind(element, event.target.value as typeof element.shape))}
            className="min-h-11 min-w-0 rounded border border-slate-500 bg-white px-2 text-lg text-slate-900"
          >
            <option value="RECTANGLE">矩形</option>
            <option value="ELLIPSE">楕円</option>
            <option value="LINE">線</option>
            <option value="ARROW">矢印</option>
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['strokeColor', '線色', element.strokeColor ?? '#dc2626'],
              ['fillColor', '塗り色', element.fillColor ?? 'transparent'],
              ['strokeWidthRatio', '線幅比率 (%)', element.strokeWidthRatio ?? 0.008]
            ] as const).map(([key, label, value]) => (
              <label key={key} className="grid gap-0.5 text-sm font-semibold">
                {label}
                <Input
                  type={key === 'strokeWidthRatio' ? 'number' : key === 'fillColor' ? 'text' : 'color'}
                  min={key === 'strokeWidthRatio' ? 0.1 : undefined}
                  max={key === 'strokeWidthRatio' ? 20 : undefined}
                  step={key === 'strokeWidthRatio' ? 0.1 : undefined}
                  value={key === 'strokeWidthRatio' ? ratioToPercent(Number(value)) : value}
                  className="min-h-11 min-w-0 !px-2 text-lg"
                  onChange={(event) => patch({ [key]: key === 'strokeWidthRatio' ? clamp(percentToRatio(numberValue(event.target.value, Number(value) * 100)), 0.001, 0.2) : event.target.value })}
                />
              </label>
            ))}
          </div>
          {(element.shape === 'LINE' || element.shape === 'ARROW') ? (
            <fieldset className="grid gap-1 rounded border border-white/10 p-2">
              <legend className="px-1 text-xs font-bold text-white/70">線分の始点・終点</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ['start', '始点', element.start ?? { xRatio: bbox.xRatio, yRatio: bbox.yRatio }],
                  ['end', '終点', element.end ?? { xRatio: bbox.xRatio + bbox.widthRatio, yRatio: bbox.yRatio + bbox.heightRatio }]
                ] as const).flatMap(([pointKey, pointLabel, point]) => (
                  (['xRatio', 'yRatio'] as const).map((axis) => (
                    <label key={`${pointKey}-${axis}`} className="grid gap-0.5 text-sm font-semibold">
                      {pointLabel} {axis === 'xRatio' ? 'X' : 'Y'} (%)
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={ratioToPercent(point[axis])}
                        className="min-h-11 min-w-0 !px-2 text-lg"
                        onChange={(event) => patch({ [pointKey]: { ...point, [axis]: Math.max(0, Math.min(1, percentToRatio(numberValue(event.target.value, point[axis] * 100)))) } })}
                      />
                    </label>
                  ))
                ))}
              </div>
            </fieldset>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="grid gap-1 rounded border border-white/10 p-2">
        <legend className="px-1 text-xs font-bold text-white/70">位置と大きさ（元ページに対する %）</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            ['xRatio', '左'],
            ['yRatio', '上'],
            ['widthRatio', '幅'],
            ['heightRatio', '高さ']
          ] as const).map(([key, label]) => (
            <label key={key} className="grid gap-0.5 text-sm font-semibold">
              {label} (%)
              <Input
                type="number"
                data-kiosk-sop-target={key === 'xRatio' ? 'assembly-document-editor-position-x' : undefined}
                min={0}
                max={100}
                step={0.5}
                value={ratioToPercent(bbox[key])}
                className="min-h-11 min-w-0 !px-2 text-lg"
                onChange={(event) => onUpdate(updateOverlayBBox(element, normalizeOverlayBBox({ ...bbox, [key]: percentToRatio(numberValue(event.target.value, bbox[key] * 100)) })))}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="grid gap-1 text-sm font-semibold">
        不透明度 (%)
        <Input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={ratioToPercent(element.opacity ?? 1)}
          className="min-h-11 min-w-0 !px-2 text-lg"
          onChange={(event) => patch({ opacity: clamp(percentToRatio(numberValue(event.target.value, (element.opacity ?? 1) * 100)), 0, 1) })}
        />
      </label>

      <fieldset className="grid gap-1 rounded border border-white/10 p-2">
        <legend className="px-1 text-xs font-bold text-white/70">重なり順とマスク</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" variant="ghostOnDark" className="min-h-11 !px-2 text-xs" onClick={() => onBringForward(element.id)}>
            前面へ
          </Button>
          <Button type="button" variant="ghostOnDark" className="min-h-11 !px-2 text-xs" onClick={() => onSendBackward(element.id)}>
            背面へ
          </Button>
        </div>
        {(element.kind === 'TEXT' || element.kind === 'IMAGE') ? (
          <>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={element.mask?.enabled ?? false}
                onChange={(event) => patch({ mask: { enabled: event.target.checked, color: element.mask?.color ?? '#ffffff' } })}
              />
              白マスクを有効化
            </label>
            <label className="grid min-h-11 grid-cols-[auto_1fr] items-center gap-2 text-sm font-semibold">
              <span>マスク色</span>
              <Input
                type="color"
                value={element.mask?.color ?? '#ffffff'}
                className="min-h-11 min-w-0 !p-1 text-lg"
                onChange={(event) => patch({ mask: { enabled: element.mask?.enabled ?? true, color: event.target.value } })}
              />
            </label>
          </>
        ) : null}
      </fieldset>
      </fieldset>

      <ConfirmDialog
        isOpen={deleteOpen}
        title="オーバーレイを削除"
        description="このオーバーレイを削除します。保存前なら元に戻せます。"
        confirmLabel="削除"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={() => {
          setDeleteOpen(false);
          onDelete();
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </aside>
  );
}
