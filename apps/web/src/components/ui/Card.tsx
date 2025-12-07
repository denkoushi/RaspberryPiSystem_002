import clsx from 'clsx';

import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps extends PropsWithChildren {
  title?: string;
  action?: ReactNode;
  className?: string;
}

export function Card({ title, action, className, children }: CardProps) {
  return (
    <section className={clsx('rounded-xl border border-white/10 bg-white/5 p-4 text-white', className)}>
      {title ? (
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}
