import type { FastifyInstance } from 'fastify';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

/**
 * システム情報エンドポイント
 * GET /api/system/system-info
 * CPU温度とCPU負荷を返す
 */
export function registerSystemInfoRoute(app: FastifyInstance): void {
  app.get('/system/system-info', async (request, reply) => {
    try {
      // CPU温度を取得（ラズパイの場合）
      let cpuTemp: number | null = null;
      try {
        const { stdout } = await execAsync('vcgencmd measure_temp', { timeout: 2000 });
        // 出力例: "temp=45.6'C"
        const match = stdout.match(/temp=([\d.]+)'C/);
        if (match) {
          cpuTemp = parseFloat(match[1]);
        }
      } catch (error) {
        // vcgencmdが利用できない場合（非ラズパイ環境など）は無視
        request.log.debug({ err: error }, 'vcgencmd not available');
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

