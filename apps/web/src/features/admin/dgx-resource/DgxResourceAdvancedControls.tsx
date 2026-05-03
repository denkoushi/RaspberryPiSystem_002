import type { ReactNode } from 'react';

type Props = {
  summary: string;
  /** 復旧モードでも最初から開いたいとき true */
  defaultOpen?: boolean;
  children: ReactNode;
};

/** 詳細・保守ブロック共通の `<details>` ラッパ（折りたたみの見た目を揃える） */
export function DgxResourceAdvancedControls({ summary, defaultOpen = false, children }: Props) {
  return (
    <details className="shrink-0 rounded-lg border border-white/12 bg-slate-950/40" {...(defaultOpen ? { open: true } : {})}>
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-white/80">{summary}</summary>
      <div className="border-t border-white/10 px-2 pb-2 pt-2">{children}</div>
    </details>
  );
}
