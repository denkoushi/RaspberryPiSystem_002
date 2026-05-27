import type { ReactNode } from 'react';

type Props = {
  step: number;
  children: ReactNode;
  className?: string;
};

export function LoadBalancingStepHeading({ step, children, className = '' }: Props) {
  return (
    <p className={`inline-flex items-center gap-1.5 text-xs font-semibold text-white ${className}`.trim()}>
      <span
        className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-600 text-[11px] font-black leading-none text-white"
        aria-hidden
      >
        {step}
      </span>
      <span>{children}</span>
    </p>
  );
}
