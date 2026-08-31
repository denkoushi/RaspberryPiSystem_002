import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

import type { WorkInstructionOverlayCreationKind } from './workInstructionEditorDraft';

export function WorkInstructionOverlayTypeDialog({ isOpen, onClose, onSelect }: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (kind: WorkInstructionOverlayCreationKind) => void;
}) {
  return <Dialog isOpen={isOpen} onClose={onClose} title="追加する種類を選択" description="選択範囲を元画像に固定したまま、編集可能な注記として追加します。" size="sm"><div className="mt-4 grid gap-2" role="radiogroup" aria-label="オーバーレイ種類">{([['TEXT', '文章', '文字を入力・修正します。'], ['IMAGE', '画像', '画像assetを配置します。'], ['SHAPE', '図形・記号', '矩形・楕円・線・矢印を配置します。']] as const).map(([kind, label, description]) => <Button key={kind} type="button" variant="ghost" className="flex min-h-11 flex-col items-start gap-0.5 !px-3 !py-2 text-left" role="radio" onClick={() => onSelect(kind)}><span className="font-bold">{label}</span><span className="text-xs text-slate-600">{description}</span></Button>)}</div><div className="mt-4 flex justify-end"><Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>キャンセル</Button></div></Dialog>;
}
