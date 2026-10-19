import { readProductionBuildConfig } from '../../config/productionBuildConfig';

import {
  decideKioskRuntimeRecovery,
  KIOSK_RUNTIME_RECOVERY_STORAGE_KEY,
  type KioskRuntimeRecoveryDecision
} from './kioskRuntimeRecovery';

export type BrowserRuntimeRecoveryDecision =
  | { kind: 'reload'; href: string }
  | { kind: 'stop' };

export interface BrowserRuntimeRecoveryController {
  decide(error: unknown): BrowserRuntimeRecoveryDecision;
  replace(href: string): void;
  reload(): void;
}

function stop(): BrowserRuntimeRecoveryDecision {
  return { kind: 'stop' };
}

function persistReloadDecision(
  decision: KioskRuntimeRecoveryDecision
): BrowserRuntimeRecoveryDecision {
  if (decision.kind !== 'reload') return stop();
  try {
    window.sessionStorage.setItem(
      KIOSK_RUNTIME_RECOVERY_STORAGE_KEY,
      decision.storedValue
    );
  } catch {
    return stop();
  }
  return { kind: 'reload', href: decision.href };
}

export const browserKioskRuntimeRecovery: BrowserRuntimeRecoveryController = {
  decide(error: unknown): BrowserRuntimeRecoveryDecision {
    let storedValue: string | null;
    try {
      storedValue = window.sessionStorage.getItem(KIOSK_RUNTIME_RECOVERY_STORAGE_KEY);
    } catch {
      return stop();
    }

    return persistReloadDecision(decideKioskRuntimeRecovery({
      error,
      pathname: window.location.pathname,
      currentHref: window.location.href,
      currentOrigin: window.location.origin,
      releaseSha: readProductionBuildConfig().releaseSha,
      storedValue
    }));
  },
  replace(href: string): void {
    window.location.replace(href);
  },
  reload(): void {
    window.location.reload();
  }
};
