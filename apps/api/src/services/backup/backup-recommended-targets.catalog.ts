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
 * キオスク（Pi4）の nfc-agent .env / Tailscale 状態 / status-agent 設定は推奨しない。
 * どれも秘密情報（client key・ノード鍵）で、外部ストレージに平文で置くと端末のなりすましに使える。
 * キオスクは Ansible で再構築し、新しい端末IDを発行して復旧する（ADR-20260820）。
 */
/**
 * 永続・一次資産のみ（派生キャッシュは含めない）。
 * Dropbox は容量が小さいため、大きくなり得る領域（knowledge-assets / knowledge-git /
 * assembly-procedure-assets / procedure-materials / procedure-videos）は推奨に含めず、
 * Google Drive DR（scripts/google_drive_dr/source_policy.py）だけで保護する。
 * work-instruction-assets は登録を保つために残す（本番では無効化し、Google Drive DR で保護）。
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
    {
      id: 'server-directory-work-instruction-assets',
      message: 'SharePoint作業要領の原本画像ストレージ（ホスト永続ボリューム）',
      target: {
        kind: 'directory',
        source: '/app/storage/work-instruction-assets',
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
    {
      id: 'server-directory-measuring-instrument-genres',
      message: '計測機器ジャンル画像ストレージ（ホスト永続ボリューム）',
      target: {
        kind: 'directory',
        source: '/app/storage/measuring-instrument-genres',
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
    {
      id: 'server-directory-pallet-machine-illustrations',
      message: 'パレット加工機イラストストレージ（ホスト永続ボリューム）',
      target: {
        kind: 'directory',
        source: '/app/storage/pallet-machine-illustrations',
        schedule: DEFAULT_SCHEDULE,
        enabled: true,
        storage: DROPBOX,
        retention: DEFAULT_RETENTION,
      },
    },
  ];

  return server;
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
