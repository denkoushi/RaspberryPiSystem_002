import { useEffect, useMemo, useRef, useState } from 'react';

import { useHoldKioskNav } from '../../features/kiosk/kioskNavLock';
import { TagDeskDock, dockModeOf } from '../../features/kiosk/tag-desk/TagDeskDock';
import { TagDeskPinPad } from '../../features/kiosk/tag-desk/TagDeskPinPad';
import { TagDeskRegistry } from '../../features/kiosk/tag-desk/TagDeskRegistry';
import { TagDeskTether } from '../../features/kiosk/tag-desk/TagDeskTether';
import { tagDesk } from '../../features/kiosk/tag-desk/tagDeskTheme';
import { useTagDesk } from '../../features/kiosk/tag-desk/useTagDesk';

import type { TagDeskKind } from '../../api/domains/tag-desk';

/**
 * Kiosk "タグ管理": read a tag to see where it is bound and release it, bind free tags, and
 * edit the employees / tools / instruments / rigging gear that carry tags.
 * The verified PIN lives only while this page is mounted. While it is unlocked the other kiosk
 * tabs cannot be reached; the lock button returns to the PIN pad, where they can.
 */
export function KioskTagDeskPage() {
  const [pin, setPin] = useState<string | null>(null);
  if (!pin) return <TagDeskPinPad onUnlocked={setPin} />;
  return <TagDesk pin={pin} onLock={() => setPin(null)} />;
}

function TagDesk({ pin, onLock }: { pin: string; onLock: () => void }) {
  useHoldKioskNav();
  const state = useTagDesk(pin);
  const [confirming, setConfirming] = useState<string | null>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mode = dockModeOf(state);

  // A new tag, another row or a form closes any half-finished release.
  useEffect(() => setConfirming(null), [state.uid, state.selection, state.form]);

  const bindings = useMemo(() => (mode === 'tag' ? state.bindings ?? [] : []), [mode, state.bindings]);
  const hitKinds = useMemo(
    () => new Set(bindings.map((binding) => binding.kind).filter((kind): kind is TagDeskKind => kind !== 'inventory')),
    [bindings]
  );
  const hitIds = useMemo(
    () => new Set(bindings.filter((binding) => binding.kind === state.kind).map((binding) => binding.targetId ?? '')),
    [bindings, state.kind]
  );
  const freeTag = mode === 'tag' && !state.bindingsLoading && bindings.length === 0;
  const showTether = mode === 'tag' || mode === 'record';

  return (
    <div className={`-mx-4 -my-4 flex min-h-0 flex-1 flex-col ${tagDesk.ink}`}>
      <div ref={deskRef} className="relative grid min-h-0 flex-1 grid-cols-[640px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-5 p-5">
        <TagDeskDock pin={pin} state={state} confirming={confirming} setConfirming={setConfirming} tokenRef={tokenRef} />
        <TagDeskRegistry state={state} hitKinds={hitKinds} hitIds={hitIds} releasing={confirming !== null} listRef={listRef} onLock={onLock} />
        {showTether ? (
          <TagDeskTether
            deskRef={deskRef}
            tokenRef={tokenRef}
            listRef={listRef}
            tone={confirming ? 'cut' : freeTag ? 'pending' : 'signal'}
            layoutKey={[mode, state.uid, state.kind, state.selection?.id, state.visibleRows.length, bindings.length, confirming, state.notice].join('|')}
          />
        ) : null}
      </div>
    </div>
  );
}
