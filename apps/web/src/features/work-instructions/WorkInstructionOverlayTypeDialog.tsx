import { WorkInstructionEditorButton, WorkInstructionEditorDialog } from './WorkInstructionEditorControls';

import type { WorkInstructionOverlayCreationKind } from './workInstructionEditorDraft';

export function WorkInstructionOverlayTypeDialog({ isOpen, onClose, onSelect }: { isOpen: boolean; onClose: () => void; onSelect: (kind: WorkInstructionOverlayCreationKind) => void }) {
  return <WorkInstructionEditorDialog isOpen={isOpen} onClose={onClose} title="注釈の種類" description="選んだ範囲に追加します。"><div className="mt-4 flex gap-2" aria-label="注釈の種類">{([['TEXT', '文章'], ['IMAGE', '画像'], ['SHAPE', '図形']] as const).map(([kind, label]) => <WorkInstructionEditorButton key={kind} onClick={() => onSelect(kind)}>{label}</WorkInstructionEditorButton>)}</div><div className="mt-4 flex justify-end"><WorkInstructionEditorButton onClick={onClose}>キャンセル</WorkInstructionEditorButton></div></WorkInstructionEditorDialog>;
}
