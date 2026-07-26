import {
  ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO,
  normalizeAssemblyProcedureCropRect
} from '@raspi-system/shared-types';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AssemblyProcedureCropMinimap } from './AssemblyProcedureCropView';

import type { AssemblyProcedureStepDraft } from './assemblyProcedureStepDraft';
import type { AssemblyEditorPageOption } from './assemblyTemplateDraft';

type Props = {
  step: AssemblyProcedureStepDraft;
  page: AssemblyEditorPageOption | null;
  readOnly?: boolean;
  showFullPage: boolean;
  onShowFullPageChange: (show: boolean) => void;
  onPatch: (patch: Partial<AssemblyProcedureStepDraft>) => void;
};

export function AssemblyProcedureStepInspector({
  step,
  page,
  readOnly = false,
  showFullPage,
  onShowFullPageChange,
  onPatch
}: Props) {
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
    <div className="grid min-w-0 gap-3">
      <div>
        <h2 className="text-base font-bold">手順指示</h2>
        <p className="mt-0.5 truncate text-xs text-white/55">
          {page?.label ?? `ページ ${step.pageIndex + 1}`} ·{' '}
          {step.viewMode === 'crop' ? '矩形フォーカス' : 'ページ全体'}
        </p>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-white/70">
        タイトル
        <Input
          value={step.title}
          maxLength={120}
          disabled={readOnly}
          onChange={(event) => onPatch({ title: event.target.value.slice(0, 120) })}
        />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-white/70">
        指示文
        <textarea
          className="min-h-28 resize-y rounded border border-white/10 bg-slate-950 p-2 text-sm text-white"
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
      <fieldset className="grid grid-cols-3 gap-1">
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
      {step.crop && page ? (
        <div className="grid gap-2 rounded border border-cyan-300/20 bg-cyan-950/20 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold">元ページ内の位置</span>
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10 !px-2 text-xs"
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
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10"
              disabled={readOnly}
              onClick={() => nudgeCrop(0, -ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO)}
            >
              ↑
            </Button>
            <span />
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10"
              disabled={readOnly}
              onClick={() => nudgeCrop(-ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO, 0)}
            >
              ←
            </Button>
            <span className="grid place-items-center text-[0.65rem] text-white/50">0.25%</span>
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10"
              disabled={readOnly}
              onClick={() => nudgeCrop(ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO, 0)}
            >
              →
            </Button>
            <span />
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10"
              disabled={readOnly}
              onClick={() => nudgeCrop(0, ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO)}
            >
              ↓
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
