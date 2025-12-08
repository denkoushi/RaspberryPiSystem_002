import clsx from 'clsx';
import { forwardRef } from 'react';

import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function InputComponent({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        'w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-white placeholder-white/60 focus:border-emerald-300 focus:outline-none',
        className
      )}
      {...rest}
    />
  );
});
