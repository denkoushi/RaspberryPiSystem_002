export function deployStatusFilePath(): string {
  return process.env.DEPLOY_STATUS_FILE_PATH ?? '/app/config/deploy-status.json';
}

export const DEPLOY_STATUS_ENTRY_TTL_MS = 30 * 60 * 1000;
