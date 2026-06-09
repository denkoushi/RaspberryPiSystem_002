import { clearAutoRotationVmCache } from './self-inspection-machine-board-auto-rotation.cache.js';

/** 自主検査機種別ボードの render 跨ぎキャッシュを無効化する。 */
export function resetSelfInspectionMachineBoardScheduleRowCaches(): void {
  clearAutoRotationVmCache();
}
