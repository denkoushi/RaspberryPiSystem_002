import type { FastifyInstance } from 'fastify';
import { readFile } from 'fs/promises';
import os from 'os';

/**
 * システム情報エンドポイント
 * GET /api/system/system-info
 * CPU温度とCPU負荷を返す
 */
export function registerSystemInfoRoute(app: FastifyInstance): void {
  app.get('/system/system-info', async (request, reply) => {
    try {
      // CPU温度を取得（ラズパイの場合）
      // /sys/class/thermal/thermal_zone0/tempから読み取る（ミリ度で返される）
      let cpuTemp: number | null = null;
      try {
        const tempData = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
        const tempMillidegrees = parseInt(tempData.trim(), 10);
        if (!isNaN(tempMillidegrees)) {
          cpuTemp = tempMillidegrees / 1000; // ミリ度を度に変換
        }
      } catch (error) {
        // ファイルが読めない場合（非ラズパイ環境など）は無視
        request.log.debug({ err: error }, 'thermal_zone0/temp not available');
      }

      // CPU負荷を取得（1分平均）
      const loadAvg = os.loadavg();
      const cpuLoadPercent = Math.min(100, (loadAvg[0] / os.cpus().length) * 100);

      return reply.send({
        cpuTemp,
        cpuLoad: Math.round(cpuLoadPercent * 10) / 10, // 小数点第1位まで
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to get system info');
      return reply.status(500).send({ error: 'Failed to get system info' });
    }
  });
}

