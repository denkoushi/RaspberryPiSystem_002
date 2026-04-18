import { useState } from 'react';

import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';

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
        <div className={mpKioskTheme.verifyCollapsedBar}>
          <span className={mpKioskTheme.verifyCollapsedTitle}>照合（移動票・現品票）</span>
          <span className={mpKioskTheme.verifyCollapsedHint}>タップで入力・照合</span>
          <button
            type="button"
            className={mpKioskTheme.verifyExpandButton}
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
