import { toUpperTrimmedCode } from '../../lib/string-normalize.js';

export function resolveMachineFactory(resourceCd: string | null | undefined, sendaiResourceCds: ReadonlySet<string>): 'MISHIMA' | 'SENDAI' {
  const normalized = toUpperTrimmedCode(resourceCd ?? '');
  return normalized && sendaiResourceCds.has(normalized) ? 'SENDAI' : 'MISHIMA';
}
