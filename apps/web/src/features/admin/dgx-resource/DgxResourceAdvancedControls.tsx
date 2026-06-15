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
    <details className="shrink-0 rounded-lg border border-slate-300 bg-white" {...(defaultOpen ? { open: true } : {})}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-slate-700">{summary}</summary>
      <div className="border-t border-slate-200 px-3 pb-3 pt-3">{children}</div>
    </details>
  );
}
