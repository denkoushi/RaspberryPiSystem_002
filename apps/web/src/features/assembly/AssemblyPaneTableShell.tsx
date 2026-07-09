import type { ReactNode } from 'react';

type Column = {
  key: string;
  label: string;
  widthClassName: string;
  align?: 'left' | 'right';
};

type Props = {
  ariaLabel: string;
  columns: Column[];
  empty: boolean;
  emptyMessage: string;
  children: ReactNode;
};

export function AssemblyPaneTableShell({ ariaLabel, columns, empty, emptyMessage, children }: Props) {
  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <p className="w-full rounded border border-white/10 bg-slate-900/65 px-3 py-6 text-center text-xs font-semibold text-white/55">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-1">
      <div className="min-h-0 overflow-auto rounded border border-white/10 bg-slate-950/35 p-0.5">
        <table className="w-full table-fixed border-collapse text-left text-[11px]" aria-label={ariaLabel}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} className={column.widthClassName} />
            ))}
          </colgroup>
          <thead className="sticky top-0 bg-slate-900 text-[11px] text-white/70">
            <tr className="border-b border-white/10">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={
                    column.align === 'right'
                      ? 'px-1.5 py-1 text-right font-bold'
                      : 'px-1.5 py-1 font-bold'
                  }
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export const assemblyTablePrimaryRowClassName = 'border-t border-white/10 first:border-t-0';
export const assemblyTableSecondaryRowClassName = 'border-b border-white/10 last:border-b-0';
export const assemblyTableGroupRowClassName =
  'border-t border-white/15 bg-slate-900/65 first:border-t-0';
export const assemblyTablePrimaryCellClassName = 'truncate px-1.5 py-0.5 font-bold text-white';
export const assemblyTableMutedCellClassName =
  'truncate px-1.5 py-0.5 font-semibold text-white/80';
export const assemblyTableSecondaryCellClassName = 'px-1.5 pb-0.5 pt-0 text-[11px] text-white/55';
export const assemblyTableActionButtonClassName =
  'inline-flex min-h-11 min-w-[1.75rem] shrink-0 items-center justify-center rounded !px-1.5 !py-0 text-xs leading-none whitespace-nowrap';
