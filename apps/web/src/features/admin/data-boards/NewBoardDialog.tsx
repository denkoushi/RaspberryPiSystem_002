import { Dialog } from '../../../components/ui/Dialog';

export type BoardTemplate = 'uninspected' | 'measuring' | 'rigging' | 'pallet' | 'blank' | 'inspection_csv';

const GRAPH_TEMPLATES: Array<{ value: BoardTemplate; name: string; description: string }> = [
  { value: 'uninspected', name: '未点検加工機', description: '点検していない機械を目立たせる' },
  { value: 'measuring', name: '計測機器 点検状況', description: '計測機器の点検と持出' },
  { value: 'rigging', name: '吊具 点検状況', description: '吊具の点検と持出' },
  { value: 'pallet', name: 'パレット現在状態', description: '加工機ごとのパレット' },
];

/** 新しいボードの作り方を選ぶ（ひな形から。JSON を一から書く作り方は隅に置く） */
export function NewBoardDialog({
  isOpen,
  onClose,
  onPick,
  isCreatingTable,
}: {
  isOpen: boolean;
  onClose: () => void;
  onPick: (template: BoardTemplate) => void;
  isCreatingTable: boolean;
}) {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="新しいボード" size="lg" className="signage-hub sh-dialog">
      <div className="sh-col" style={{ gap: 16 }}>
        <span className="sh-eyebrow">点検・現場の状態を見せる（グラフ）</span>
        <div className="sh-templates">
          {GRAPH_TEMPLATES.map((template) => (
            <button key={template.value} type="button" className="sh-template" onClick={() => onPick(template.value)}>
              <span className="sh-template-name">{template.name}</span>
              <span className="sh-item-meta">{template.description}</span>
            </button>
          ))}
        </div>
        <span className="sh-eyebrow">取り込んだ CSV を見せる（表）</span>
        <div className="sh-templates">
          <button type="button" className="sh-template" onClick={() => onPick('inspection_csv')} disabled={isCreatingTable}>
            <span className="sh-template-name">加工機 日常点検結果</span>
            <span className="sh-item-meta">{isCreatingTable ? '作成中…' : '点検結果 CSV の表をすぐ作る'}</span>
          </button>
        </div>
        <div className="sh-row-between" style={{ borderTop: '1px solid var(--sh-line)', paddingTop: 14 }}>
          <button type="button" className="sh-mini-btn" onClick={() => onPick('blank')}>
            ひな形なしで作る（JSON）
          </button>
          <button type="button" className="sh-btn" onClick={onClose}>
            やめる
          </button>
        </div>
      </div>
    </Dialog>
  );
}
