import { readProductionBuildConfig } from '../../config/productionBuildConfig';

import { getNfcWsCandidates } from './nfcEventSource';
import { resolveNfcStreamPolicy, type NfcStreamPolicy } from './nfcPolicy';

export const NFC_LOOPBACK_STATUS_URL = 'http://127.0.0.1:7071/api/agent/status';

export interface NfcRuntimeContract {
  policy: NfcStreamPolicy;
  streamUrls: readonly string[];
  statusUrl: string | null;
}

export interface NfcAgentStatus {
  readerConnected: true;
  queueSize: 0;
}

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

export const isLoopbackUrl = (raw: string): boolean => {
  try {
    return isLoopbackHostname(new URL(raw).hostname);
  } catch {
    return false;
  }
};

export function resolveNfcRuntimeContract(
  policyOverride?: NfcStreamPolicy
): NfcRuntimeContract {
  const policy = policyOverride ?? resolveNfcStreamPolicy();
  const buildConfig = readProductionBuildConfig();
  const streamUrls = getNfcWsCandidates({
    policy,
    envUrl: buildConfig.agentWsUrl,
    mode: buildConfig.agentWsMode,
    location:
      typeof window === 'undefined'
        ? undefined
        : { protocol: window.location.protocol, host: window.location.host }
  });
  return {
    policy,
    streamUrls,
    statusUrl: policy === 'localOnly' ? NFC_LOOPBACK_STATUS_URL : null
  };
}

export function isHealthyNfcAgentStatus(value: unknown): value is NfcAgentStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return status.readerConnected === true && status.queueSize === 0;
}

export function isDeployableNfcRuntime(contract: NfcRuntimeContract): boolean {
  return (
    contract.policy === 'localOnly' &&
    contract.statusUrl === NFC_LOOPBACK_STATUS_URL &&
    contract.streamUrls.length === 1 &&
    isLoopbackUrl(contract.streamUrls[0])
  );
}

export interface ProveNfcRuntimeOptions {
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
}

export async function proveNfcRuntimeReady(
  contract: NfcRuntimeContract,
  options: ProveNfcRuntimeOptions = {}
): Promise<boolean> {
  if (!isDeployableNfcRuntime(contract) || !contract.statusUrl) return false;
  const fetcher = options.fetcher ?? fetch;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));

  for (let sample = 0; sample < 2; sample += 1) {
    if (options.signal?.aborted) return false;
    try {
      const response = await fetcher(contract.statusUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: options.signal
      });
      if (!response.ok || !isHealthyNfcAgentStatus(await response.json())) return false;
    } catch {
      return false;
    }
    if (sample === 0) await wait(1000);
  }
  return !options.signal?.aborted;
}
