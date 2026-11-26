import { toUpperTrimmedCode } from '../../lib/string-normalize.js';

export type MachineFactory = 'MISHIMA' | 'SENDAI';

export function resolveMachineFactory(resourceCd: string | null | undefined, sendaiResourceCds: ReadonlySet<string>): MachineFactory {
  const normalized = toUpperTrimmedCode(resourceCd ?? '');
  return normalized && sendaiResourceCds.has(normalized) ? 'SENDAI' : 'MISHIMA';
}
