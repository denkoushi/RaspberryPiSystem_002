import type { ReactNode } from 'react';

type DueManagementLayoutShellProps = {
  activeContext: ReactNode;
  leftRail: ReactNode;
  detailPanel: ReactNode;
};

export function DueManagementLayoutShell(props: DueManagementLayoutShellProps) {
  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
      <section className="overflow-hidden rounded-lg border border-white/20 bg-slate-900/60">
        {props.leftRail}
      </section>
      <section className="overflow-hidden rounded-lg border border-white/20 bg-slate-900/60">
        <div className="border-b border-white/15 bg-slate-950/40 px-4 py-2">{props.activeContext}</div>
        <div className="h-[calc(100%-57px)]">{props.detailPanel}</div>
      </section>
    </div>
  );
}
