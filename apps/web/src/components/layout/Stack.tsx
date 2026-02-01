import clsx from 'clsx';

import type { HTMLAttributes } from 'react';

type StackProps = HTMLAttributes<HTMLDivElement> & {
  direction?: 'row' | 'column';
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  wrap?: boolean;
};

const alignClass: Record<NonNullable<StackProps['align']>, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  baseline: 'items-baseline',
  stretch: 'items-stretch'
};

const justifyClass: Record<NonNullable<StackProps['justify']>, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly'
};

export function Stack({
  direction = 'column',
  align = 'start',
  justify = 'start',
  wrap = false,
  className,
  ...rest
}: StackProps) {
  return (
    <div
      className={clsx(
        'flex',
        direction === 'row' ? 'flex-row' : 'flex-col',
        alignClass[align],
        justifyClass[justify],
        wrap ? 'flex-wrap' : 'flex-nowrap',
        className
      )}
      {...rest}
    />
  );
}
