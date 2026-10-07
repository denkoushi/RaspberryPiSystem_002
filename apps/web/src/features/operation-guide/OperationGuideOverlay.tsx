import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

import { resolveGuideStep, type OperationGuide } from './definitions';
import { GuideIcon } from './GuideIcon';
import { OperationGuideChoices } from './OperationGuideChoices';
import { OperationGuideRing } from './OperationGuideRing';
import { placeGuideCard } from './placement';
import { useGuideTarget } from './useGuideTarget';

export function OperationGuideOverlay({ guide, index, iconRef, onBack, onNext, onEnd, onQuestion, onChoose }: {
  guide: OperationGuide; index: number; iconRef: RefObject<HTMLElement>;
  onBack: () => void; onNext: () => void; onEnd: () => void; onQuestion: () => void; onChoose: (id: OperationGuide['id']) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const cardRef = useRef<HTMLElement>(null);
  const complete = index >= guide.steps.length;
  const step = complete ? null : resolveGuideStep(guide.steps[index]);
  const { target, icon, size, viewport } = useGuideTarget(step?.targetId, location.key, cardRef, iconRef);
  const placement = placeGuideCard(viewport, size, target, icon);
  useEffect(() => { cardRef.current?.focus(); }, [guide.id, complete]);
  const needsNavigation = step?.path && location.pathname.replace(/\/$/u, '') !== step.path;
  return createPortal(<>
    {target && !complete ? <OperationGuideRing target={target} number={index + 1} /> : null}
    <section ref={cardRef} tabIndex={-1} className="operation-guide-card" aria-label="操作ガイド" style={{ left: placement.left, top: placement.top }}>
      <header><span className="operation-guide-label"><GuideIcon name="guide" />操作ガイド</span><b>手順 {Math.min(index + 1, guide.steps.length)} / {guide.steps.length}</b></header>
      <div className="operation-guide-card__content">
        <div aria-live="polite" aria-atomic="true">
          <h2>{complete ? <GuideIcon name="check" /> : <GuideIcon name="next" />}{complete ? '案内が完了しました' : step?.title}</h2>
          <p className="operation-guide-card__description">{complete ? '続けて確認する操作を選べます。' : step?.description}</p>
        </div>
        {needsNavigation ? <button type="button" className="operation-guide-card__navigate" onClick={() => navigate(step.path!)}>ライブラリへ移動<GuideIcon name="next" /></button> : null}
        {complete ? <OperationGuideChoices exclude={guide.id} onChoose={onChoose} /> : null}
        <nav aria-label="案内の移動">
          <button type="button" aria-label="戻る" disabled={index === 0} onClick={onBack}><GuideIcon name="back" /></button>
          {!complete ? <button type="button" className="operation-guide-card__next" onClick={onNext}>次へ<GuideIcon name="next" /></button> : null}
          <button type="button" className="operation-guide-card__end" onClick={onEnd}><GuideIcon name="close" />終了</button>
        </nav>
        <button type="button" className="operation-guide-card__question" onClick={onQuestion}><GuideIcon name="chat" />質問に戻る</button>
        <div className="operation-guide-progress" role="progressbar" aria-label="案内の進捗" aria-valuemin={0} aria-valuemax={guide.steps.length} aria-valuenow={Math.min(index + 1, guide.steps.length)}>
          {guide.steps.map((_, number) => <i key={number} className={number <= index ? 'operation-guide-progress__passed' : ''} />)}
        </div>
      </div>
    </section>
  </>, document.body);
}
