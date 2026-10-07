import type { GuideRect } from './placement';

export function OperationGuideRing({ target, number }: { target: GuideRect; number: number }) {
  return <div className="operation-guide-ring" aria-hidden="true" style={{ left: target.left - 7, top: target.top - 7, width: target.width + 14, height: target.height + 14 }}>
    <span>{number}</span>
  </div>;
}
