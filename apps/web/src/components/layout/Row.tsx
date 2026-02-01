import clsx from 'clsx';

import type { HTMLAttributes } from 'react';

type RowProps = HTMLAttributes<HTMLDivElement> & {
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  wrap?: boolean;
};

const alignClass: Record<NonNullable<RowProps['align']>, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  baseline: 'items-baseline',
  stretch: 'items-stretch'
};

const justifyClass: Record<NonNullable<RowProps['justify']>, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly'
};

export function Row({
  align = 'center',
  justify = 'start',
  wrap = false,
  className,
  ...rest
}: RowProps) {
  return (
    <div
      className={clsx(
        'flex',
        alignClass[align],
        justifyClass[justify],
        wrap ? 'flex-wrap' : 'flex-nowrap',
        className
      )}
      {...rest}
    />
  );
}
