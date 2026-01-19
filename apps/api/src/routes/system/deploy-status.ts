import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

const DEPLOY_STATUS_FILE = '/app/config/deploy-status.json';

interface DeployStatus {
  kioskMaintenance: boolean;
  scope?: string;
  startedAt?: string;
}

async function readDeployStatus(): Promise<DeployStatus> {
  // ローカルテスト用: 環境変数でメンテナンスモードを強制できるようにする
  if (process.env.FORCE_KIOSK_MAINTENANCE === 'true') {
    return {
      kioskMaintenance: true,
      scope: 'raspberrypi4',
      startedAt: new Date().toISOString()
    };
  }

  try {
    const content = await readFile(DEPLOY_STATUS_FILE, 'utf-8');
    const status = JSON.parse(content) as DeployStatus;
    return {
      kioskMaintenance: status.kioskMaintenance ?? false,
      scope: status.scope,
      startedAt: status.startedAt
    };
  } catch (error) {
    // ファイルが存在しない場合はデフォルト値を返す
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kioskMaintenance: false };
    }
    // その他のエラー（JSONパースエラーなど）もデフォルト値を返す
    return { kioskMaintenance: false };
  }
}

export function registerDeployStatusRoute(app: FastifyInstance): void {
  app.get('/system/deploy-status', async () => {
    const status = await readDeployStatus();
    return status;
  });
}
