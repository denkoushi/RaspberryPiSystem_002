/**
 * WebRTCルート登録
 */

import type { FastifyInstance } from 'fastify';
import { registerWebRTCSignaling } from './signaling.js';

export async function registerWebRTCRoutes(app: FastifyInstance): Promise<void> {
  // 環境変数で有効/無効を切り替え可能
  const webrtcEnabled = process.env.WEBRTC_ENABLED === 'true';
  const envValue = process.env.WEBRTC_ENABLED;
  app.log.info({ webrtcEnabled, envValue }, 'WebRTC routes registration check');
  if (!webrtcEnabled) {
    app.log.info('WebRTC routes disabled (WEBRTC_ENABLED !== true)');
    return; // 無効化されている場合は何もしない
  }

  await app.register(
    async (subApp) => {
      app.log.info('Registering WebRTC signaling routes');
      registerWebRTCSignaling(subApp);
    },
    { prefix: '/webrtc' }
  );
  app.log.info('WebRTC routes registered successfully');
}

