import { WorkInstructionEditorButton as Button } from './WorkInstructionEditorControls';
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
    <section className="grid min-w-0 gap-2" data-testid="work-instruction-memo-editor" aria-label="作業メモ編集">
      {step ? <>
        <span className="text-sm text-[#9fadb9]">手順 {step.step}</span>
        <div className="rounded-lg border border-[#27313b] p-3 text-sm text-[#9fadb9]"><span>原本 · 読み取り専用</span><p className="mt-2 whitespace-pre-wrap break-words text-lg text-[#eef3f6]">{step.text}</p></div>
        <label className="grid gap-0.5 text-sm font-semibold">表示するメモ<textarea data-testid="work-instruction-editor-memo-value" aria-label="表示するメモ" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${WORK_INSTRUCTION_EDITOR_INPUT_CLASS_NAME} h-24 resize-none`} /></label>
        <div className="flex gap-2"><Button disabled={disabled || !override} onClick={onReset}>原本に戻す</Button>{needsReview ? <Button disabled={disabled} onClick={onKeep}>このメモを維持</Button> : null}</div>
      </> : <p className="text-sm text-[#9fadb9]">手順を選んでください。</p>}
    </section>
  );
}
