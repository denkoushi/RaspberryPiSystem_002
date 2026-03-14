import { CollapsibleToggleIcon } from './CollapsibleToggleIcon';

import type { ReactNode } from 'react';

export type CollapsibleSectionAccent = 'emerald' | 'blue' | 'amber';

const ACCENT_CLASSES: Record<
  CollapsibleSectionAccent,
  { border: string; headerOpen: string; headerClosed: string; contentOpen: string }
> = {
  emerald: {
    border: 'border-l-4 border-l-emerald-400',
    headerOpen: 'bg-emerald-500/25 border-emerald-400/50',
    headerClosed: 'bg-emerald-500/8 border-emerald-400/25',
    contentOpen: 'bg-emerald-500/20',
  },
  blue: {
    border: 'border-l-4 border-l-blue-400',
    headerOpen: 'bg-blue-500/25 border-blue-400/50',
    headerClosed: 'bg-blue-500/8 border-blue-400/25',
    contentOpen: 'bg-blue-500/20',
  },
  amber: {
    border: 'border-l-4 border-l-amber-400',
    headerOpen: 'bg-amber-500/25 border-amber-400/50',
    headerClosed: 'bg-amber-500/8 border-amber-400/25',
    contentOpen: 'bg-amber-500/20',
  },
};

type CollapsibleSectionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
  accent?: CollapsibleSectionAccent;
};

export function CollapsibleSection(props: CollapsibleSectionProps) {
  const accent = props.accent ?? 'blue';
  const classes = ACCENT_CLASSES[accent];
  const headerClass = props.isOpen ? classes.headerOpen : classes.headerClosed;
  return (
    <section
      className={`mb-3 rounded border border-l-4 border-white/20 bg-white/5 ${classes.border}`}
    >
      <div
        className={`flex items-center justify-between gap-2 rounded-t border-b border-white/10 px-3 py-2 ${headerClass}`}
      >
        <h3 className="text-xs font-semibold text-white">{props.title}</h3>
        <div className="flex items-center gap-2">
          {props.actions}
          <button
            type="button"
            className="rounded bg-slate-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-600 min-w-8"
            onClick={props.onToggle}
            aria-expanded={props.isOpen}
            aria-label={`${props.title}を${props.isOpen ? '折りたたむ' : '展開する'}`}
          >
            <CollapsibleToggleIcon
              isOpen={props.isOpen}
              ariaLabel={`${props.title}を${props.isOpen ? '折りたたむ' : '展開する'}`}
            />
          </button>
        </div>
      </div>
      {props.isOpen ? (
        <div className={`rounded-b border-t border-white/10 px-3 pb-3 pt-2 ${classes.contentOpen}`}>
          {props.children}
        </div>
      ) : null}
    </section>
  );
}
