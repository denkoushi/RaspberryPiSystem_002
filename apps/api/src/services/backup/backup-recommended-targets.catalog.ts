import type { BackupConfig } from './backup-config.js';

/** 推奨ターゲットの安定ID（health.details.recommendationId / UI キー）。 */
export type RecommendedBackupTargetSpec = {
  id: string;
  /** 運用者向け短い説明（health メッセージに使う） */
  message: string;
  /** `backup.json` の targets にそのまま追加できる形 */
  target: BackupConfig['targets'][number];
};

const DEFAULT_SCHEDULE = '0 2 * * *';
const DEFAULT_RETENTION: NonNullable<BackupConfig['targets'][number]['retention']> = {
  days: 14,
  maxBackups: 4,
};
const DROPBOX: NonNullable<BackupConfig['targets'][number]['storage']> = {
  provider: 'dropbox',
};

/**
 * Ansible inventory のキオスク（Pi4）で、第2工場の増設端末。
 * raspberrypi4 は既存環境で多くが個別登録済みのため、推奨カタログには含めない。
 * （未登録なら同パターンのテンプレ / 手動追加で補完可能）
 */
const PI4_KIOSK_CLIENTS: Array<{ inventoryHost: string; sshHomeUser: string }> = [
  { inventoryHost: 'raspi4-robodrill01', sshHomeUser: 'tools04' },
  { inventoryHost: 'raspi4-fjv60-80', sshHomeUser: 'raspi4-fjv60-80' },
  { inventoryHost: 'raspi4-kensaku-stonebase01', sshHomeUser: 'raspi4-kensaku-stonebase01' },
];

function kioskClientSpecs(host: string, sshHomeUser: string): RecommendedBackupTargetSpec[] {
  const base = host.replace(/[^a-z0-9-]/gi, '-');
  return [
    {
      id: `kiosk-${base}-nfc-agent-env`,
      message: `キオスク (${host}) の NFC エージェント .env`,
      target: {
        kind: 'client-file',
        source: `${host}:/opt/RaspberryPiSystem_002/clients/nfc-agent/.env`,
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
    {
      id: `kiosk-${base}-ssh`,
      message: `キオスク (${host}) の運用ユーザー SSH 設定 (~/.ssh)`,
      target: {
        kind: 'client-directory',
        source: `${host}:/home/${sshHomeUser}/.ssh`,
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
    {
      id: `kiosk-${base}-tailscale-state`,
      message: `キオスク (${host}) の Tailscale 状態ディレクトリ`,
      target: {
        kind: 'client-directory',
        source: `${host}:/var/lib/tailscale`,
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
    {
      id: `kiosk-${base}-status-agent-conf`,
      message: `キオスク (${host}) の status-agent 設定`,
      target: {
        kind: 'client-file',
        source: `${host}:/etc/raspi-status-agent.conf`,
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
  ];
}

/**
 * 永続・一次資産のみ（派生キャッシュは含めない）。
 * 変更時は KB / 運用ドキュメントも更新すること。
 */
export function getRecommendedBackupTargetCatalog(): RecommendedBackupTargetSpec[] {
  const server: RecommendedBackupTargetSpec[] = [
    {
      id: 'server-directory-part-measurement-drawings',
      message: '部品測定図面ストレージ（ホスト永続ボリューム）',
      target: {
        kind: 'directory',
        source: '/app/storage/part-measurement-drawings',
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
  ];

  const kiosks = PI4_KIOSK_CLIENTS.flatMap((k) => kioskClientSpecs(k.inventoryHost, k.sshHomeUser));

  return [...server, ...kiosks];
}

function targetIdentity(t: Pick<BackupConfig['targets'][number], 'kind' | 'source'>): string {
  return `${t.kind}\0${t.source}`;
}

/**
 * 設定に「同一 kind + source」の行がある場合は推奨済みとみなす（enabled:false も intentional と解釈して警告しない）。
 */
export function findMissingRecommendedBackupTargets(config: BackupConfig): RecommendedBackupTargetSpec[] {
  const existing = new Set(config.targets.map((t) => targetIdentity(t)));
  return getRecommendedBackupTargetCatalog().filter((spec) => !existing.has(targetIdentity(spec.target)));
}
