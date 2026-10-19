import { KIOSK_INITIAL_ROUTE_LABELS, normalizeKioskInitialRoute } from '@raspi-system/shared-types';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useUpdateKioskInitialRoute } from '../../api/hooks';
import { resolveActiveKioskHeaderTab, resolveCurrentKioskInitialRoute } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderTabActivity';

import { KioskHomeIcon } from './KioskHomeIcon';

import type { KioskInitialRouteId } from '@raspi-system/shared-types';

type Props = {
  clientKey: string;
  pathname: string;
  initialKioskRoute?: string | null;
  defaultMode?: 'PHOTO' | 'TAG';
};
type Notice = { message: string; undo?: { initialRoute: KioskInitialRouteId | null }; duration: number };

export function KioskInitialRouteButton({ clientKey, pathname, initialKioskRoute, defaultMode }: Props) {
  const mutation = useUpdateKioskInitialRoute(clientKey);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dockHeight, setDockHeight] = useState(122);
  const currentRoute = resolveCurrentKioskInitialRoute(pathname);
  const savedRoute = normalizeKioskInitialRoute(initialKioskRoute);
  const effectiveRoute = savedRoute ?? (defaultMode === 'PHOTO' ? 'borrow_photo' : 'borrow_tag');
  const isInitial = currentRoute !== null && currentRoute === effectiveRoute;
  const activeTab = resolveActiveKioskHeaderTab(pathname);
  const blockedMessage = activeTab === 'tag_desk' || activeTab === 'due_management'
    ? 'PIN の画面は開始ページにできません' : 'この画面は開始ページにできません';
  const label = currentRoute === null ? blockedMessage : isInitial ? 'この画面が開始ページです' : 'この画面を開始ページにする';

  useEffect(() => {
    const dock = buttonRef.current?.closest('header');
    if (!dock) return;
    const measure = () => setDockHeight(dock.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.duration);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const save = async (route: KioskInitialRouteId | null, undo = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const previousRoute = savedRoute;
      const result = await mutation.mutateAsync(route);
      if (undo) {
        setNotice({ message: '開始ページを元に戻しました', duration: 3000 });
      } else {
        const resolvedRoute = result.initialKioskRoute ?? (defaultMode === 'PHOTO' ? 'borrow_photo' : 'borrow_tag');
        setNotice({ message: `起動時に「${KIOSK_INITIAL_ROUTE_LABELS[resolvedRoute]}」を開きます`, undo: { initialRoute: previousRoute }, duration: 6000 });
      }
    } catch {
      setNotice({ message: '開始ページを保存できませんでした', duration: 3000 });
    } finally {
      savingRef.current = false;
    }
  };

  const handleClick = () => {
    if (currentRoute === null || isInitial) {
      setNotice({ message: currentRoute === null ? blockedMessage : 'この画面が開始ページです', duration: 3000 });
      return;
    }
    void save(currentRoute);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        disabled={mutation.isPending}
        aria-label={label}
        title={label}
        aria-pressed={isInitial}
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border hover:bg-inv-s2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan ${currentRoute === null ? 'border-inv-line text-inv-faint' : isInitial ? 'border-inv-cyan text-inv-cyan' : 'border-inv-line2 text-inv-text'}`}
      >
        <KioskHomeIcon filled={isInitial} />
      </button>
      {notice && createPortal(
        <div role="status" className="fixed right-5 z-50 flex max-w-[calc(100vw-40px)] items-center gap-4 rounded-xl border border-inv-line2 bg-inv-s3 px-5 py-3 text-lg font-semibold text-inv-text shadow-lg" style={{ bottom: dockHeight + 16 }}>
          <span>{notice.message}</span>
          {notice.undo && <button type="button" disabled={mutation.isPending} className="h-11 shrink-0 rounded-lg border border-inv-line2 px-4 text-inv-cyan hover:bg-inv-s2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan" onClick={() => void save(notice.undo!.initialRoute, true)}>元に戻す</button>}
        </div>, document.body
      )}
    </>
  );
}
