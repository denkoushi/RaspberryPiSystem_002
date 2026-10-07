import { operationGuides, type OperationGuide } from './definitions';
import { GuideIcon } from './GuideIcon';
import './operation-guide.css';

export function OperationGuideChoices({ onChoose, exclude }: { onChoose: (id: OperationGuide['id']) => void; exclude?: OperationGuide['id'] }) {
  return <div className="operation-guide-choices">
    {operationGuides.filter(item => item.id !== exclude).map(item => <button type="button" key={item.id} onClick={() => onChoose(item.id)} aria-label={`${item.label}を${item.action}`}>
      <GuideIcon name="assembly" /><span>{item.label}<small>{item.action}</small></span><GuideIcon name="next" />
    </button>)}
  </div>;
}

export function OperationGuidePrompt({ question, onChoose }: { question: string; onChoose: (id: OperationGuide['id']) => void }) {
  return <div className="operation-guide-prompt">
    <p className="operation-guide-prompt__question">{question}</p>
    <div className="operation-guide-label"><GuideIcon name="guide" />操作ガイド</div>
    <p>どの手順書ですか?</p>
    <OperationGuideChoices onChoose={onChoose} />
  </div>;
}
