import { useState } from 'react';

import { MobilePlacementVerifyExpandedPanel } from './MobilePlacementVerifyExpandedPanel';

import type { MobilePlacementVerifySectionProps } from './mobile-placement-verify-section.types';

export type { MobilePlacementVerifySectionProps } from './mobile-placement-verify-section.types';

/**
 * 上半: 移動票・現品票の照合。
 * 既定は折りたたみ（下半の登録エリアを広く）。「展開」で従来の2列入力と照合を表示。
 */
export function MobilePlacementVerifySection(props: MobilePlacementVerifySectionProps) {
  const { defaultExpanded, ...panelProps } = props;
  const [expanded, setExpanded] = useState(() => defaultExpanded ?? false);

  return (
    <>
      {!expanded ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/25 px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[12px] font-extrabold text-slate-100">照合（移動票・現品票）</span>
          <span className="hidden text-[10px] text-slate-500 sm:inline">タップで入力・照合</span>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-sky-400/45 bg-sky-500/10 px-3 py-1.5 text-[11px] font-extrabold text-sky-300 active:bg-sky-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
            aria-expanded={false}
            aria-controls="mp-verify-expanded-panel"
            onClick={() => setExpanded(true)}
          >
            展開
          </button>
        </div>
      ) : null}

      <div
        id="mp-verify-expanded-panel"
        hidden={!expanded}
        role={expanded ? 'region' : undefined}
        aria-label={expanded ? '照合（移動票・現品票）' : undefined}
        aria-hidden={!expanded}
      >
        {expanded ? (
          <MobilePlacementVerifyExpandedPanel {...panelProps} onCollapse={() => setExpanded(false)} />
        ) : null}
      </div>
    </>
  );
}
