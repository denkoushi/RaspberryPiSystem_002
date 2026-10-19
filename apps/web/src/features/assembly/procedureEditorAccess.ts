import { CLIENT_KEY_CONFIG, resolveClientKey } from '../../lib/client-key';

const STORAGE_KEY = 'procedure-editor-access';
const CHANGE_EVENT = 'procedure-editor-access-change';
export const PROCEDURE_EDITOR_ACCESS_HOURS = 8;
export type ProcedureEditorAccess = { pin: string; expiresAt: number; clientKey: string };
// Only the expiry marker is persisted; the PIN itself stays in memory for this tab (CodeQL js/clear-text-storage-of-sensitive-data).
type StoredMarker = { expiresAt: number; clientKey: string };
let memoryOnly = false;
let memoryAccess: ProcedureEditorAccess | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let scheduledExpiry: number | undefined;

// A short non-reversible fingerprint of the kiosk client key (FNV-1a), so the key itself is never copied into storage.
function clientIdentity(): string {
  let key = '';
  try { key = resolveClientKey({ allowDefaultFallback: true }).key; } catch { return ''; }
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function scheduleExpiry(access: ProcedureEditorAccess): void {
  if (scheduledExpiry === access.expiresAt) return;
  clearTimeout(expiryTimer);
  scheduledExpiry = access.expiresAt;
  expiryTimer = setTimeout(clearProcedureEditorAccess, Math.max(0, access.expiresAt - Date.now()));
}

export function saveProcedureEditorAccess(pin: string, now = Date.now()): void {
  if (pin.length < 1 || pin.length > 128) { clearProcedureEditorAccess(); return; }
  memoryOnly = false;
  memoryAccess = { pin, expiresAt: now + PROCEDURE_EDITOR_ACCESS_HOURS * 60 * 60 * 1000, clientKey: clientIdentity() };
  const marker: StoredMarker = { expiresAt: memoryAccess.expiresAt, clientKey: memoryAccess.clientKey };
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(marker)); } catch { memoryOnly = true; }
  scheduleExpiry(memoryAccess);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearProcedureEditorAccess(): void {
  clearTimeout(expiryTimer);
  scheduledExpiry = undefined;
  let hadAccess = Boolean(memoryAccess);
  memoryAccess = null;
  memoryOnly = false;
  try {
    hadAccess ||= sessionStorage.getItem(STORAGE_KEY) != null;
    sessionStorage.removeItem(STORAGE_KEY);
  } catch { memoryOnly = true; }
  if (hadAccess) window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readProcedureEditorAccess(now = Date.now()): ProcedureEditorAccess | null {
  let marker: StoredMarker | null = null;
  try { marker = memoryOnly ? memoryAccess : JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as StoredMarker | null; }
  catch { marker = memoryAccess; }
  const pin = memoryAccess?.pin;
  if (!marker || !pin || pin.length < 1 || pin.length > 128 || !Number.isFinite(marker.expiresAt) || marker.expiresAt <= now
    || marker.clientKey !== clientIdentity() || memoryAccess?.expiresAt !== marker.expiresAt) {
    clearProcedureEditorAccess();
    return null;
  }
  scheduleExpiry(memoryAccess!);
  return memoryAccess;
}

export function subscribeProcedureEditorAccess(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

if (typeof window !== 'undefined') {
  // Remove the old persistent plaintext value; never migrate it into a session.
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      readProcedureEditorAccess();
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  });
  window.addEventListener('storage', event => {
    // sessionStorage is tab-local: only same-tab frames share access changes.
    // The kiosk client key lives in localStorage and can change in another tab.
    if (event.key === null || event.key === STORAGE_KEY || event.key === CLIENT_KEY_CONFIG.storageKey) {
      readProcedureEditorAccess();
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  });
}
