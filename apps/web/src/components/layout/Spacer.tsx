import type { HTMLAttributes } from 'react';

type SpacerProps = HTMLAttributes<HTMLDivElement>;

export function Spacer({ className, ...rest }: SpacerProps) {
  return <div className={`flex-1 ${className ?? ''}`.trim()} {...rest} />;
}
