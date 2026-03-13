import { CollapsibleToggleIcon } from './CollapsibleToggleIcon';

import type { ReactNode } from 'react';

type CollapsibleCardProps = {
  isOpen: boolean;
  onToggle: () => void;
  header: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function CollapsibleCard(props: CollapsibleCardProps) {
  return (
    <div className={`rounded border ${props.className ?? ''}`}>
      <div className="flex items-center justify-between gap-2 p-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={props.onToggle}
          aria-expanded={props.isOpen}
        >
          {props.header}
        </button>
        <div className="flex items-center gap-2">
          {props.headerActions}
          <button
            type="button"
            className="rounded bg-black/20 px-2 py-1 text-[10px] font-semibold min-w-8"
            onClick={props.onToggle}
            aria-label={props.isOpen ? 'カードを折りたたむ' : 'カードを展開する'}
          >
            <CollapsibleToggleIcon
              isOpen={props.isOpen}
              ariaLabel={props.isOpen ? 'カードを折りたたむ' : 'カードを展開する'}
            />
          </button>
        </div>
      </div>
      {props.isOpen ? <div className="border-t border-white/10 px-2 pb-2 pt-1">{props.children}</div> : null}
    </div>
  );
}
