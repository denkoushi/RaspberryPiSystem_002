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
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function AssemblyProcedureDocumentEditorInspector({
  element,
  onUpdate,
  onDelete,
  onBringForward,
  onSendBackward,
  onUploadImage,
  onRefetchTextCandidates,
  readOnly = false,
  busy = false
}: {
  element: AssemblyProcedureOverlayElement | null;
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
  if (!element) {
    return (
      <aside className="flex min-h-0 w-full flex-col gap-2 border-l border-white/10 bg-slate-900/75 p-3 text-sm text-white/60 xl:w-80 xl:shrink-0" aria-label="オーバーレイ編集">
        <h2 className="text-sm font-bold text-white">オーバーレイ編集</h2>
        <p>範囲を追加するか、キャンバス上の要素を選択してください。</p>
      </aside>
    );
  }

  const patch = (next: Partial<AssemblyProcedureOverlayElement>) => onUpdate({ ...element, ...next } as AssemblyProcedureOverlayElement);
  const patchTextStyle = (next: NonNullable<Extract<AssemblyProcedureOverlayElement, { kind: 'TEXT' }>['style']>) => {
    if (element.kind !== 'TEXT') return;
    patch({ style: { ...(element.style ?? {}), ...next } });
  };
  const bbox = element.bbox;

  return (
    <aside className="flex min-h-0 w-full flex-col gap-2 overflow-auto border-l border-white/10 bg-slate-900/75 p-3 text-sm xl:w-80 xl:shrink-0" aria-label="オーバーレイ編集" aria-disabled={readOnly}>
      <fieldset disabled={readOnly} className="contents">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">{element.kind === 'TEXT' ? '文章' : element.kind === 'IMAGE' ? '画像' : '図形・記号'}編集</h2>
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
            className="min-h-24 rounded border border-white/20 bg-slate-950 px-2 py-2 text-sm text-white"
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
            <label className="grid gap-0.5 text-xs font-semibold">
              文字サイズ比率
              <Input
                type="number"
                min={0.005}
                max={0.2}
                step={0.005}
                value={element.style?.fontSizeRatio ?? 0.025}
                className="min-h-11 bg-slate-950 text-white"
                onChange={(event) => patchTextStyle({ fontSizeRatio: numberValue(event.target.value, element.style?.fontSizeRatio ?? 0.025) })}
              />
            </label>
            <label className="grid gap-0.5 text-xs font-semibold">
              文字色
              <Input
                type="color"
                value={element.style?.color ?? '#0f172a'}
                className="min-h-11 bg-slate-950 p-1"
                onChange={(event) => patchTextStyle({ color: event.target.value })}
              />
            </label>
            <label className="grid gap-0.5 text-xs font-semibold">
              太さ
              <select
                value={element.style?.fontWeight ?? 'normal'}
                onChange={(event) => patchTextStyle({ fontWeight: event.target.value as 'normal' | 'bold' })}
                className="min-h-11 rounded border border-white/20 bg-slate-950 px-2 text-white"
              >
                <option value="normal">標準</option>
                <option value="bold">太字</option>
              </select>
            </label>
            <label className="grid gap-0.5 text-xs font-semibold">
              揃え
              <select
                value={element.style?.align ?? 'start'}
                onChange={(event) => patchTextStyle({ align: event.target.value as 'start' | 'center' | 'end' })}
                className="min-h-11 rounded border border-white/20 bg-slate-950 px-2 text-white"
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
            className="min-h-11 bg-slate-950 text-white"
          />
          <input
            type="file"
            accept="image/*"
            className="min-h-11 w-full rounded border border-white/20 bg-slate-950 px-2 py-2 text-xs text-white"
            aria-label="画像ファイルをアップロード"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadImage(file);
              event.currentTarget.value = '';
            }}
          />
          <span className="text-xs font-normal text-amber-100/75">登録済みasset IDを指定するか、画像ファイルを登録できます。</span>
          <label className="grid gap-0.5 text-xs font-semibold">
            画像の収まり
            <select
              value={element.objectFit ?? 'contain'}
              onChange={(event) => patch({ objectFit: event.target.value as typeof element.objectFit })}
              className="min-h-11 rounded border border-white/20 bg-slate-950 px-2 text-white"
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
            className="min-h-11 rounded border border-white/20 bg-slate-950 px-2 text-white"
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
              ['strokeWidthRatio', '線幅比率', element.strokeWidthRatio ?? 0.008]
            ] as const).map(([key, label, value]) => (
              <label key={key} className="grid gap-0.5 text-xs font-semibold">
                {label}
                <Input
                  type={key === 'strokeWidthRatio' ? 'number' : key === 'fillColor' ? 'text' : 'color'}
                  min={key === 'strokeWidthRatio' ? 0.001 : undefined}
                  max={key === 'strokeWidthRatio' ? 0.2 : undefined}
                  step={key === 'strokeWidthRatio' ? 0.001 : undefined}
                  value={value}
                  className="min-h-11 bg-slate-950 text-white"
                  onChange={(event) => patch({ [key]: key === 'strokeWidthRatio' ? numberValue(event.target.value, Number(value)) : event.target.value })}
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
                    <label key={`${pointKey}-${axis}`} className="grid gap-0.5 text-xs font-semibold">
                      {pointLabel} {axis === 'xRatio' ? 'X' : 'Y'}
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={point[axis]}
                        className="min-h-11 bg-slate-950 text-white"
                        onChange={(event) => patch({ [pointKey]: { ...point, [axis]: Math.max(0, Math.min(1, numberValue(event.target.value, point[axis]))) } })}
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
        <legend className="px-1 text-xs font-bold text-white/70">位置と大きさ（元ページ比率）</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            ['xRatio', '左'],
            ['yRatio', '上'],
            ['widthRatio', '幅'],
            ['heightRatio', '高さ']
          ] as const).map(([key, label]) => (
            <label key={key} className="grid gap-0.5 text-xs font-semibold">
              {label}
              <Input
                type="number"
                data-kiosk-sop-target={key === 'xRatio' ? 'assembly-document-editor-position-x' : undefined}
                min={0}
                max={1}
                step={0.01}
                value={bbox[key]}
                className="min-h-11 bg-slate-950 text-white"
                onChange={(event) => onUpdate(updateOverlayBBox(element, normalizeOverlayBBox({ ...bbox, [key]: numberValue(event.target.value, bbox[key]) })))}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="grid gap-1 font-semibold">
        不透明度
        <Input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={element.opacity ?? 1}
          className="min-h-11 bg-slate-950 text-white"
          onChange={(event) => patch({ opacity: numberValue(event.target.value, element.opacity ?? 1) })}
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
            <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={element.mask?.enabled ?? false}
                onChange={(event) => patch({ mask: { enabled: event.target.checked, color: element.mask?.color ?? '#ffffff' } })}
              />
              白マスクを有効化
            </label>
            <label className="grid min-h-11 grid-cols-[auto_1fr] items-center gap-2 text-xs font-semibold">
              <span>マスク色</span>
              <Input
                type="color"
                value={element.mask?.color ?? '#ffffff'}
                className="min-h-11 bg-slate-950 p-1"
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
