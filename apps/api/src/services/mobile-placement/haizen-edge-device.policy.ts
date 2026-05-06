/**
 * Zero2W / haizen エッジ端末の判定。
 * 契約: `ClientDevice.haizenEdgeEnabled === true` のみを対象とする（文字列マッチはマイグレーションでのみ使用）。
 */

export function isHaizenEdgeDevice(device: { haizenEdgeEnabled: boolean }): boolean {
  return device.haizenEdgeEnabled === true;
}
