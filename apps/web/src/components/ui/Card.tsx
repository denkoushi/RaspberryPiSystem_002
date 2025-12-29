import clsx from 'clsx';

import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps extends PropsWithChildren {
  title?: string;
  action?: ReactNode;
  className?: string;
}

export function Card({ title, action, className, children }: CardProps) {
  return (
    <section className={clsx('rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg', className)}>
      {title ? (
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}
