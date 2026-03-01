import { getClientKeyFromUrl } from './sources';

const normalizeCandidate = (value?: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith('client-key-') ? trimmed : null;
};

/**
 * 電源操作は誤ターゲット防止のため、URL or Props の明示キーのみ許可する。
 * localStorage / default へのフォールバックは行わない。
 */
export function resolveClientKeyForPower(providedKey?: string): string | null {
  const fromProps = normalizeCandidate(providedKey);
  if (fromProps) return fromProps;

  const fromUrl = getClientKeyFromUrl();
  return fromUrl ?? null;
}
