import { useEffect, useState, type RefObject } from 'react';

import { type GuideRect } from './placement';

function visibleRect(element: HTMLElement): GuideRect | null {
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return null;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
  // Only highlight the visible portion when a nested panel clips the control.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.visibility === 'hidden' || parentStyle.opacity === '0') return null;
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/u.test(parentStyle.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
    if (/(auto|scroll|hidden|clip)/u.test(parentStyle.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

export function useGuideTarget(targetId: string | undefined, routeKey: string, cardRef: RefObject<HTMLElement>, iconRef: RefObject<HTMLElement>) {
  const [geometry, setGeometry] = useState<{ target: GuideRect | null; icon: GuideRect | null; size: { width: number; height: number }; viewport: { width: number; height: number } }>({
    target: null, icon: null, size: { width: 320, height: 280 }, viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  useEffect(() => {
    let previous = '';
    // Events follow viewport movement immediately; low-frequency sampling catches
    // dialog changes, replaced controls and layout shifts while the card is mounted.
    const measure = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(item => visibleRect(item));
      const dialog = dialogs.at(-1);
      const elements = targetId ? document.querySelectorAll<HTMLElement>(`[data-kiosk-sop-target="${targetId}"]`) : [];
      const target = Array.from(elements).filter(item => !dialog || dialog.contains(item)).map(visibleRect).find(Boolean) ?? null;
      const card = cardRef.current?.getBoundingClientRect();
      const next = {
        target,
        icon: iconRef.current ? visibleRect(iconRef.current) : null,
        size: { width: card?.width || 320, height: card?.height || 280 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
      const serialized = JSON.stringify(next);
      if (serialized !== previous) { previous = serialized; setGeometry(next); }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const interval = window.setInterval(measure, 200);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [targetId, routeKey, cardRef, iconRef]);
  return geometry;
}
