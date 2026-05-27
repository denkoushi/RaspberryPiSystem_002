import { lbStep } from './loadBalancingUiClasses';

import type { ReactNode } from 'react';

type Props = {
  step: number;
  children: ReactNode;
  className?: string;
};

export function LoadBalancingStepHeading({ step, children, className = '' }: Props) {
  return (
    <p className={`${lbStep.root} ${className}`.trim()}>
      <span className={lbStep.badge} aria-hidden>
        {step}
      </span>
      <span>{children}</span>
    </p>
  );
}
