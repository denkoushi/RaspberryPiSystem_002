import { CollapsibleToggleIcon } from './CollapsibleToggleIcon';

import type { ReactNode } from 'react';

type CollapsibleSectionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

export function CollapsibleSection(props: CollapsibleSectionProps) {
  return (
    <section className="mb-3 rounded border border-white/20 bg-white/5">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
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
      {props.isOpen ? <div className="border-t border-white/10 px-3 pb-3 pt-2">{props.children}</div> : null}
    </section>
  );
}
