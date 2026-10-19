import { useRef, useState } from 'react';

import { Input } from '../../components/ui/Input';

import {
  WorkInstructionEditorButton as Button,
  WorkInstructionEditorConfirmDialog as ConfirmDialog,
  WorkInstructionEditorPanelHeading
} from './WorkInstructionEditorControls';
import {
  convertWorkInstructionOverlayShapeKind as convertOverlayShapeKind,
  normalizeWorkInstructionOverlayBBox as normalizeOverlayBBox,
  updateWorkInstructionOverlayBBox as updateOverlayBBox
} from './workInstructionEditorDraft';
import { WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME } from './workInstructionEditorSelectStyles';

import type { WorkInstructionEditorStepDto } from '../../api/domains/work-instruction-overlays';
import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';

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

export function WorkInstructionEditorInspector({
  element,
  onUpdate,
  onDuplicate,
  onClose,
  onDelete,
  onBringForward,
  onSendBackward,
  onUploadImage,
  steps = [],
  onAssignStep,
  onRefetchTextCandidates,
  readOnly = false,
  busy = false
}: {
  element: WorkInstructionOverlayElement | null;
  onDuplicate?: () => void;
  onClose?: () => void;
  onUpdate: (element: WorkInstructionOverlayElement) => void;
  onDelete: () => void;
  onBringForward: (id: string) => void;
  onSendBackward: (id: string) => void;
  onUploadImage: (file: File) => void;
  steps?: WorkInstructionEditorStepDto[];
  onAssignStep?: (id: string, stepKey: string | null) => void;
  onRefetchTextCandidates: () => void;
  readOnly?: boolean;
  busy?: boolean;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  if (!element) return null;

  const patch = (next: Partial<WorkInstructionOverlayElement>) => onUpdate({ ...element, ...next } as WorkInstructionOverlayElement);
  const patchTextStyle = (next: NonNullable<Extract<WorkInstructionOverlayElement, { kind: 'TEXT' }>['style']>) => {
    if (element.kind !== 'TEXT') return;
    patch({ style: { ...(element.style ?? {}), ...next } });
  };
  const bbox = element.bbox;

  return (
    <aside className="flex min-h-0 w-full flex-col gap-1 text-sm text-[#eef3f6]" aria-label="注釈の編集" aria-disabled={readOnly}>
      <WorkInstructionEditorPanelHeading title={element.kind === 'TEXT' ? '文章' : element.kind === 'IMAGE' ? '画像' : '図形・記号'} onClose={onClose} />
      <fieldset disabled={readOnly} className="contents">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" className="min-h-11" onClick={onDuplicate}>複製</Button>
        <Button type="button" className="text-[#e5484d]" onClick={() => setDeleteOpen(true)}>
          削除
        </Button>
      </div>

      {element.kind === 'TEXT' ? (
        <fieldset className="grid gap-1 font-semibold">
          <legend>文章</legend>
          <textarea
            aria-label="文章" data-testid="work-instruction-editor-text-value"
            value={element.text}
            onChange={(event) => patch({ text: event.target.value })}
            className={`${WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME} h-24 resize-none`}
          />
          <Button
            type="button"
            className="min-h-11 !px-2 text-sm"
            disabled={busy}
            onClick={onRefetchTextCandidates}
          >
            この範囲で候補を再取得
          </Button>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="grid gap-0.5 text-sm font-semibold">
              文字サイズ (%)
              <Input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={ratioToPercent(element.style?.fontSizeRatio ?? 0.025)}
                className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
                onChange={(event) => patchTextStyle({ fontSizeRatio: clamp(percentToRatio(numberValue(event.target.value, (element.style?.fontSizeRatio ?? 0.025) * 100)), 0.005, 0.2) })}
              />
            </label>
            <label className="grid gap-0.5 text-sm font-semibold">
              文字色
              <Input
                type="color"
                value={element.style?.color ?? '#0f172a'}
                className={`${WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME} !p-1`}
                onChange={(event) => patchTextStyle({ color: event.target.value })}
              />
            </label>
            <label className="grid gap-0.5 text-sm font-semibold">
              太さ
              <select
                value={element.style?.fontWeight ?? 'normal'}
                onChange={(event) => patchTextStyle({ fontWeight: event.target.value as 'normal' | 'bold' })}
                className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
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
                className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
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
          <legend>画像</legend>
          <Button
            type="button"
            data-testid="work-instruction-editor-image-asset"
            className="min-h-11"
            disabled={busy || readOnly}
            onClick={() => imageInputRef.current?.click()}
          >
            画像を選ぶ
          </Button>
          <input ref={imageInputRef} type="file" accept="image/*" hidden aria-label="画像を選ぶ" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadImage(file); event.currentTarget.value = ''; }} />
          <label className="grid gap-0.5 text-sm font-semibold">
            画像の収まり
            <select
              value={element.objectFit ?? 'contain'}
              onChange={(event) => patch({ objectFit: event.target.value as typeof element.objectFit })}
              className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
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
            aria-label="図形" data-testid="work-instruction-editor-shape-kind"
            value={element.shape}
            onChange={(event) => onUpdate(convertOverlayShapeKind(element, event.target.value as typeof element.shape))}
            className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
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
              ['strokeWidthRatio', '線の太さ (%)', element.strokeWidthRatio ?? 0.008]
            ] as const).map(([key, label, value]) => (
              <label key={key} className="grid gap-0.5 text-sm font-semibold">
                {label}
                <Input
                  type={key === 'strokeWidthRatio' ? 'number' : key === 'fillColor' ? 'text' : 'color'}
                  min={key === 'strokeWidthRatio' ? 0.1 : undefined}
                  max={key === 'strokeWidthRatio' ? 20 : undefined}
                  step={key === 'strokeWidthRatio' ? 0.1 : undefined}
                  value={key === 'strokeWidthRatio' ? ratioToPercent(Number(value)) : value}
                  className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
                  onChange={(event) => patch({ [key]: key === 'strokeWidthRatio' ? clamp(percentToRatio(numberValue(event.target.value, Number(value) * 100)), 0.001, 0.2) : event.target.value })}
                />
              </label>
            ))}
          </div>
          {(element.shape === 'LINE' || element.shape === 'ARROW') ? (
            <fieldset className="grid gap-1 rounded border border-[#27313b] p-1.5">
              <legend className="px-1 text-xs font-bold text-[#9fadb9]">線分の始点・終点</legend>
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
                        className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
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

      <fieldset className="grid gap-1 rounded border border-[#27313b] p-1.5">
        <legend className="px-1 text-xs font-bold text-[#9fadb9]">位置と大きさ (%)</legend>
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
                min={0}
                max={100}
                step={0.5}
                value={ratioToPercent(bbox[key])}
                className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
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
          className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}
          onChange={(event) => patch({ opacity: clamp(percentToRatio(numberValue(event.target.value, (element.opacity ?? 1) * 100)), 0, 1) })}
        />
      </label>

      <fieldset className="grid gap-1 rounded border border-[#27313b] p-1.5">
        <legend className="px-1 text-xs font-bold text-[#9fadb9]">重なり順と背景</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" className="min-h-11 !px-2 text-sm" onClick={() => onBringForward(element.id)}>
            前面へ
          </Button>
          <Button type="button" className="min-h-11 !px-2 text-sm" onClick={() => onSendBackward(element.id)}>
            背面へ
          </Button>
        </div>
        {(element.kind === 'TEXT' || element.kind === 'IMAGE') ? (
          <div className="grid grid-cols-[1fr_94px] items-center gap-1.5">
            <label className="flex min-h-11 items-center gap-1.5 text-sm font-semibold"><input type="checkbox" className="h-[18px] w-[18px] accent-[#5fc3e8] focus-visible:outline focus-visible:outline-[#5fc3e8]" checked={element.mask?.enabled ?? false} onChange={(event) => patch({ mask: { enabled: event.target.checked, color: element.mask?.color ?? '#ffffff' } })} />背景を付ける</label>
            <label className="grid gap-0.5 text-xs font-semibold">背景色<Input type="color" value={element.mask?.color ?? '#ffffff'} className={`${WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME} !p-1`} onChange={(event) => patch({ mask: { enabled: element.mask?.enabled ?? true, color: event.target.value } })} /></label>
          </div>
        ) : null}
      </fieldset>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="grid gap-0.5 text-sm font-semibold">状態<select className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME} value={String(element.migrationState ?? 'MIGRATED').toUpperCase()} onChange={(event) => patch({ migrationState: event.target.value as WorkInstructionOverlayElement['migrationState'] })}><option value="MIGRATED">確認済み</option><option value="NEEDS_REVIEW">要確認</option><option value="SKIPPED">対象外</option>{String(element.migrationState).toUpperCase() === 'UNASSIGNED' ? <option value="UNASSIGNED">未割当</option> : null}</select></label>
        <label className="grid gap-0.5 text-sm font-semibold">手順<select className={WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME} value={element.stepKey ?? ''} onChange={(event) => onAssignStep?.(element.id, event.target.value || null)}><option value="">未割当</option>{steps.map((step) => <option key={step.stepKey} value={step.stepKey}>手順 {step.step}</option>)}</select></label>
      </div>
      </fieldset>

      <ConfirmDialog
        isOpen={deleteOpen}
        title="注釈を削除"
        description="この注釈を削除します。"
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
