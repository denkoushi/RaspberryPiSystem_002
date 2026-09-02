import { Button } from '../../components/ui/Button';

import { memoOverrideNeedsReview } from './workInstructionEditorMemo';
import { WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME } from './workInstructionEditorSelectStyles';

import type {
  WorkInstructionEditorStepDto,
  WorkInstructionMemoOverrideDto
} from '../../api/domains/work-instruction-overlays';

export type WorkInstructionMemoEditorProps = {
  step: WorkInstructionEditorStepDto | null;
  value: string;
  override: WorkInstructionMemoOverrideDto | null;
  disabled?: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  onKeep: () => void;
};

export function WorkInstructionMemoEditor({
  step,
  value,
  override,
  disabled = false,
  onChange,
  onReset,
  onKeep
}: WorkInstructionMemoEditorProps) {
  const needsReview = memoOverrideNeedsReview(override);

  return (
    <section className="grid min-w-0 gap-2 rounded border border-cyan-300/30 bg-cyan-300/10 p-2" data-testid="work-instruction-memo-editor" aria-label="作業メモ編集">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-cyan-50">作業メモ</h2>
        {override ? <span className="shrink-0 text-xs text-cyan-100/80">上書きあり</span> : <span className="shrink-0 text-xs text-white/60">原本を表示中</span>}
      </div>
      {step ? (
        <>
          <div className="min-w-0 rounded border border-white/10 bg-slate-950/70 p-2 text-xs text-white/70">
            <p className="font-semibold text-white/80">原本（編集不可）</p>
            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">{step.text}</p>
          </div>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-white">
            表示するメモ
            <textarea
              data-testid="work-instruction-editor-memo-value"
              aria-label="表示するメモ"
              value={value}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
              className={`min-h-28 w-full min-w-0 resize-y rounded border border-white/20 px-2 py-2 text-sm leading-6 focus:border-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME}`}
            />
          </label>
          {needsReview ? (
            <div className="grid min-w-0 gap-2 rounded border border-amber-300/40 bg-amber-300/10 p-2 text-xs text-amber-100" role="alert">
              <p className="break-words">原本が更新されています。このメモを維持する場合は対象原本との一致を確認してください。</p>
              <Button type="button" variant="ghostOnDark" className="min-h-11 justify-self-start !px-3 text-xs" disabled={disabled} onClick={onKeep}>
                このメモを維持
              </Button>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button type="button" variant="ghostOnDark" className="min-h-11 !px-3 text-xs" disabled={disabled || !override} onClick={onReset}>
              原本を使用
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-white/60">手順を選択するとメモを編集できます。</p>
      )}
    </section>
  );
}
