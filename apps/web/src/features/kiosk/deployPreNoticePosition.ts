export const DEPLOY_PRE_NOTICE_MOVE_STEP_PX = 10;
export const DEPLOY_PRE_NOTICE_VIEWPORT_MARGIN_PX = 16;

export type DeployPreNoticeOffset = { x: number; y: number };

export type DeployPreNoticeDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export function moveDeployPreNoticeOffset(
  offset: DeployPreNoticeOffset,
  direction: DeployPreNoticeDirection
): DeployPreNoticeOffset {
  switch (direction) {
    case 'ArrowUp':
      return { ...offset, y: offset.y - DEPLOY_PRE_NOTICE_MOVE_STEP_PX };
    case 'ArrowDown':
      return { ...offset, y: offset.y + DEPLOY_PRE_NOTICE_MOVE_STEP_PX };
    case 'ArrowLeft':
      return { ...offset, x: offset.x - DEPLOY_PRE_NOTICE_MOVE_STEP_PX };
    case 'ArrowRight':
      return { ...offset, x: offset.x + DEPLOY_PRE_NOTICE_MOVE_STEP_PX };
  }
}

export function clampDeployPreNoticeOffset(
  offset: DeployPreNoticeOffset,
  viewportWidth: number,
  viewportHeight: number,
  cardWidth: number,
  cardHeight: number,
  margin = DEPLOY_PRE_NOTICE_VIEWPORT_MARGIN_PX
): DeployPreNoticeOffset {
  const maxX = Math.max(0, (viewportWidth - cardWidth) / 2 - margin);
  const maxY = Math.max(0, (viewportHeight - cardHeight) / 2 - margin);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y))
  };
}

export function isDeployPreNoticeMoveKey(key: string): key is DeployPreNoticeDirection {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/** 入力操作やボタン操作中は、通知カードに矢印キーを奪わせない。 */
export function isDeployPreNoticeKeyboardTargetInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, button, a[href], [contenteditable="true"], [role="button"]')
  );
}
