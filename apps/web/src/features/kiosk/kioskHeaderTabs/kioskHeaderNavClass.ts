import clsx from 'clsx';

export function kioskHeaderNavClass(isActive: boolean): string {
  return clsx(
    'inline-flex h-11 items-center rounded-lg px-4 text-base tracking-[.01em] whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan',
    isActive
      ? 'bg-inv-cyan text-inv-cyan-ink font-bold'
      : 'font-semibold text-inv-text/[.86] hover:bg-inv-s2 active:bg-inv-s3'
  );
}
