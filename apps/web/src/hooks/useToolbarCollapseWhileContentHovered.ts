import { useCallback, useEffect, useRef, useState } from 'react';

/** カードグリッドからポインタが抜けたあと、ヘッダ再表示までの猶予（境界跨ぎのちらつき抑制） */
export const TOOLBAR_COLLAPSE_WHILE_CONTENT_HOVER_LEAVE_MS = 280;

export type ToolbarCollapseWhileContentHoveredHandlers = {
  /** コンテンツホットゾーン上では true（ツールバー行を畳む） */
  toolbarCollapsed: boolean;
  onContentMouseEnter: () => void;
  onContentMouseLeave: () => void;
};

/**
 * 既定でツールバー行を表示し、指定ホットゾーン（例: カード一覧）にポインタがある間だけ畳む。
 * 下ペインの `useTimedHoverReveal`（ホバーで開く）とは逆方向の関心事のため別フックに分離。
 */
export function useToolbarCollapseWhileContentHovered(
  enabled: boolean
): ToolbarCollapseWhileContentHoveredHandlers {
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const onContentMouseEnter = useCallback(() => {
    if (!enabled) return;
    clearLeaveTimer();
    setToolbarCollapsed(true);
  }, [clearLeaveTimer, enabled]);

  const onContentMouseLeave = useCallback(() => {
    if (!enabled) return;
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      setToolbarCollapsed(false);
    }, TOOLBAR_COLLAPSE_WHILE_CONTENT_HOVER_LEAVE_MS);
  }, [clearLeaveTimer, enabled]);

  useEffect(() => {
    if (!enabled) {
      clearLeaveTimer();
      setToolbarCollapsed(false);
    }
  }, [clearLeaveTimer, enabled]);

  useEffect(() => () => clearLeaveTimer(), [clearLeaveTimer]);

  return {
    toolbarCollapsed,
    onContentMouseEnter,
    onContentMouseLeave
  };
}
