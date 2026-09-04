import {
  ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO,
  normalizeAssemblyProcedureCropRect
} from '@raspi-system/shared-types';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AssemblyProcedureCropMinimap } from './AssemblyProcedureCropView';
import { assemblyEditorPageName } from './assemblyTemplateGuidePresentation';

import type { AssemblyProcedureStepDraft } from './assemblyProcedureStepDraft';
import type { AssemblyEditorPageOption } from './assemblyTemplateDraft';

type Props = {
  step: AssemblyProcedureStepDraft;
  page: AssemblyEditorPageOption | null;
  readOnly?: boolean;
  showFullPage: boolean;
  onShowFullPageChange: (show: boolean) => void;
  onPatch: (patch: Partial<AssemblyProcedureStepDraft>) => void;
  includeCropControls?: boolean;
};

type CropProps = Pick<
  Props,
  'step' | 'page' | 'readOnly' | 'showFullPage' | 'onShowFullPageChange' | 'onPatch'
>;

export function AssemblyProcedureStepCropInspector({
  step,
  page,
  readOnly = false,
  showFullPage,
  onShowFullPageChange,
  onPatch
}: CropProps) {
  if (!step.crop || !page) return null;
  const nudgeCrop = (xDelta: number, yDelta: number) => {
    if (!step.crop) return;
    onPatch({
      crop: normalizeAssemblyProcedureCropRect(
        {
          xRatio: step.crop.xRatio + xDelta,
          yRatio: step.crop.yRatio + yDelta
        },
        {
          xRatio: step.crop.xRatio + step.crop.widthRatio + xDelta,
          yRatio: step.crop.yRatio + step.crop.heightRatio + yDelta
        }
      )
    });
  };
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 rounded border border-cyan-300/20 bg-cyan-950/20 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-bold" title="元ページ内の位置">元ページ内の位置</span>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-10 shrink-0 !px-2 text-xs"
          aria-pressed={showFullPage}
          onClick={() => onShowFullPageChange(!showFullPage)}
        >
          {showFullPage ? '矩形へ戻る' : '全体を一時表示'}
        </Button>
      </div>
      <AssemblyProcedureCropMinimap
        pageUrl={page.imageRelativePath}
        crop={step.crop}
        className="h-28 w-full"
      />
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="矩形位置の微調整">
        <span />
        <Button type="button" variant="ghostOnDark" className="min-h-10" disabled={readOnly} onClick={() => nudgeCrop(0, -ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO)}>↑</Button>
        <span />
        <Button type="button" variant="ghostOnDark" className="min-h-10" disabled={readOnly} onClick={() => nudgeCrop(-ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO, 0)}>←</Button>
        <span className="grid place-items-center text-[0.65rem] text-white/50">0.25%</span>
        <Button type="button" variant="ghostOnDark" className="min-h-10" disabled={readOnly} onClick={() => nudgeCrop(ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO, 0)}>→</Button>
        <span />
        <Button type="button" variant="ghostOnDark" className="min-h-10" disabled={readOnly} onClick={() => nudgeCrop(0, ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO)}>↓</Button>
      </div>
    </div>
  );
}

export function AssemblyProcedureStepInspector({
  step,
  page,
  readOnly = false,
  showFullPage,
  onShowFullPageChange,
  onPatch,
  includeCropControls = true
}: Props) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold">手順指示</h2>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-white/55">
          {page ? (
            <span className="min-w-0 flex-1 truncate" title={page.label}>
              {assemblyEditorPageName(page.label, page.pageIndex)}
            </span>
          ) : null}
          <span className="shrink-0">
            P{step.pageIndex + 1} · {step.viewMode === 'crop' ? '矩形' : '全体'}
          </span>
        </p>
      </div>
      <label className="grid min-w-0 grid-cols-1 gap-1 text-xs font-semibold text-white/70">
        タイトル
        <Input
          className="min-w-0"
          value={step.title}
          maxLength={120}
          disabled={readOnly}
          onChange={(event) => onPatch({ title: event.target.value.slice(0, 120) })}
        />
      </label>
      <label className="grid min-w-0 grid-cols-1 gap-1 text-xs font-semibold text-white/70">
        指示文
        <textarea
          className="min-h-28 w-full min-w-0 resize-y rounded border border-white/10 bg-slate-950 p-2 text-sm text-white"
          value={step.instructionText}
          maxLength={1000}
          disabled={readOnly}
          onChange={(event) =>
            onPatch({ instructionText: event.target.value.slice(0, 1000) })
          }
        />
        <span className="text-right text-[0.65rem] text-white/45">
          {step.instructionText.length}/1000
        </span>
      </label>
      <fieldset className="grid min-w-0 grid-cols-3 gap-1">
        <legend className="mb-1 text-xs font-semibold text-white/70">重要度</legend>
        {([
          ['normal', '○ 標準'],
          ['important', '◆ 重要'],
          ['caution', '⚠ 注意']
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={step.emphasis === value ? 'primary' : 'ghostOnDark'}
            className="min-h-10 !px-1 text-xs"
            aria-pressed={step.emphasis === value}
            disabled={readOnly}
            onClick={() => onPatch({ emphasis: value })}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      {includeCropControls ? (
        <AssemblyProcedureStepCropInspector
          step={step}
          page={page}
          readOnly={readOnly}
          showFullPage={showFullPage}
          onShowFullPageChange={onShowFullPageChange}
          onPatch={onPatch}
        />
      ) : null}
    </div>
  );
}
