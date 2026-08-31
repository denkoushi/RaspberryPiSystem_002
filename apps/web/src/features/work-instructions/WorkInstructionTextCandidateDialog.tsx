import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

import type { WorkInstructionTextCandidateDto } from '../../api/domains/work-instruction-overlays';

export function WorkInstructionTextCandidateDialog({ candidates, isOpen, onSelect, onManual, onClose }: {
  candidates: WorkInstructionTextCandidateDto[];
  isOpen: boolean;
  onSelect: (candidate: WorkInstructionTextCandidateDto) => void;
  onManual: () => void;
  onClose: () => void;
}) {
  return <Dialog isOpen={isOpen} onClose={onClose} title="文章候補を選択" description="選択範囲から抽出した候補です。候補を選ぶと文章注記として配置します。" size="md"><div className="mt-4 grid max-h-[min(50vh,24rem)] gap-2 overflow-auto" role="listbox" aria-label="文章候補">{candidates.map((candidate, index) => <Button key={`${candidate.text}-${index}`} type="button" variant="ghost" role="option" className="flex min-h-11 items-start justify-between gap-3 border border-slate-200 bg-slate-50 !px-3 !py-2 text-left text-slate-900 hover:bg-slate-100 hover:text-slate-900" onClick={() => onSelect(candidate)}><span className="whitespace-pre-wrap break-words font-semibold">{candidate.text || '（空の候補）'}</span><span className="shrink-0 text-xs text-slate-600">{candidate.confidence == null ? candidate.source : `確度 ${Math.round(candidate.confidence * 100)}%`}</span></Button>)}</div><div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" className="min-h-11" onClick={onManual}>手入力で追加</Button><Button type="button" variant="ghost" className="min-h-11 text-slate-800" onClick={onClose}>キャンセル</Button></div></Dialog>;
}
