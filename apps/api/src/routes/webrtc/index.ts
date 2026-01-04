/**
 * WebRTCルート登録
 */

import type { FastifyInstance } from 'fastify';
import { registerWebRTCSignaling } from './signaling.js';

export async function registerWebRTCRoutes(app: FastifyInstance): Promise<void> {
  // 環境変数で有効/無効を切り替え可能
  if (process.env.WEBRTC_ENABLED !== 'true') {
    return; // 無効化されている場合は何もしない
  }

  await app.register(
    async (subApp) => {
      registerWebRTCSignaling(subApp);
    },
    { prefix: '/webrtc' }
  );
}

