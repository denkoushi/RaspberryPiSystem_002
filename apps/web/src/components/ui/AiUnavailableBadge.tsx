import { cloneElement, useId } from 'react';

import { IconActionTooltip } from './IconActionTooltip';

import type { ButtonHTMLAttributes, ReactElement } from 'react';

export function AiUnavailableBadge({ unavailable, children, positioned = false, ringColor = '#161c22' }: {
  unavailable?: boolean;
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  positioned?: boolean;
  ringColor?: string;
}) {
  const hintId = useId();
  if (!unavailable) return children;

  return <IconActionTooltip label="AI 未起動" displayContents>
    {cloneElement(children, {
      className: `${children.props.className ?? ''}${positioned ? '' : ' relative'}`,
      title: undefined,
      'aria-describedby': [children.props['aria-describedby'], hintId].filter(Boolean).join(' ')
    }, <>
      {children.props.children}
      <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-[#f6b93b] text-base font-extrabold leading-none text-[#161c22]" style={{ boxShadow: `0 0 0 2px ${ringColor}` }}>!</span>
      <span id={hintId} aria-hidden="true" className="sr-only">AI 未起動</span>
    </>)}
  </IconActionTooltip>;
}
