import type { NfcStreamPolicy } from './nfcPolicy';

type LocationLike = {
  protocol: string;
  host: string;
};

type CandidatesInput = {
  policy: NfcStreamPolicy;
  envUrl?: string;
  // build-time/env modes. We keep 'local' for backward compatibility.
  mode?: string;
  location?: LocationLike;
};

/**
 * NFC Agentへ接続するWebSocket URL候補を生成する。
 *
 * - localOnly: `ws://localhost:7071/stream`のみ（共有/中継へは絶対にフォールバックしない）
 * - disabled: 候補なし（購読しない）
 * - legacy: 既存互換（HTTPSなら`wss://<host>/stream`も候補に入れる）
 */
export const getNfcWsCandidates = (input: CandidatesInput): string[] => {
  const { policy } = input;
  if (policy === 'disabled') return [];
  if (policy === 'localOnly') return ['ws://localhost:7071/stream'];

  const envUrl = input.envUrl ?? 'ws://localhost:7071/stream';
  const mode = String(input.mode ?? '').toLowerCase();
  const location = input.location;

  const candidates: string[] = [];
  const add = (url: string | undefined) => {
    if (!url) return;
    if (candidates.includes(url)) return;
    candidates.push(url);
  };

  // legacy互換: local modeならlocalhostを先に入れる
  if (mode === 'local') {
    add('ws://localhost:7071/stream');
  }

  // legacy互換: HTTPSページの場合は /stream を host 経由のWSSとして扱う（Caddy等の中継）
  if (location?.protocol === 'https:') {
    add(`wss://${location.host}/stream`);
  }

  add(envUrl);
  return candidates;
};

