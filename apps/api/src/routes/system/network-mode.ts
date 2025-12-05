import dns from 'node:dns';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

const dnsPromises = dns.promises;
const CONNECTIVITY_TEST_HOSTS = ['github.com', 'tailscale.com', 'cloudflare.com'];
const CONNECTIVITY_TIMEOUT_MS = 2000;

function getNetworkStatusOverride(): 'internet_connected' | 'local_network_only' | null {
  const value = process.env.NETWORK_STATUS_OVERRIDE ?? env.NETWORK_STATUS_OVERRIDE;
  if (value === 'internet_connected' || value === 'local_network_only') {
    return value;
  }
  return null;
}

async function hasInternetConnectivity(): Promise<{ connected: boolean; details: string }> {
  const override = getNetworkStatusOverride();
  if (override) {
    const connected = override === 'internet_connected';
    return {
      connected,
      details: 'override'
    };
  }

  for (const host of CONNECTIVITY_TEST_HOSTS) {
    const success = await lookupWithTimeout(host, CONNECTIVITY_TIMEOUT_MS);
    if (success) {
      return { connected: true, details: host };
    }
  }
  return { connected: false, details: 'unreachable' };
}

async function lookupWithTimeout(host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    dnsPromises
      .lookup(host)
      .then(() => {
        clearTimeout(timer);
        resolve(true);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}

export function registerNetworkModeRoute(app: FastifyInstance): void {
  app.get('/system/network-mode', async () => {
    const start = performance.now();
    const connectivity = await hasInternetConnectivity();
    const latencyMs = Number((performance.now() - start).toFixed(2));
    const detectedMode = connectivity.connected ? 'maintenance' : 'local';
    const status = connectivity.connected ? 'internet_connected' : 'local_network_only';

    return {
      detectedMode,
      configuredMode: env.NETWORK_MODE,
      status,
      checkedAt: new Date().toISOString(),
      latencyMs,
      source: connectivity.details
    };
  });
}

