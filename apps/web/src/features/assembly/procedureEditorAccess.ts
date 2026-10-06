import { CLIENT_KEY_CONFIG, resolveClientKey } from '../../lib/client-key';

const STORAGE_KEY = 'procedure-editor-access';
const CHANGE_EVENT = 'procedure-editor-access-change';
export const PROCEDURE_EDITOR_ACCESS_HOURS = 8;
export type ProcedureEditorAccess = { pin: string; expiresAt: number; clientKey: string };
let memoryOnly = false;
let memoryAccess: ProcedureEditorAccess | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let scheduledExpiry: number | undefined;

function clientIdentity(): string {
  try { return resolveClientKey({ allowDefaultFallback: true }).key; } catch { return ''; }
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
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memoryAccess)); } catch { memoryOnly = true; }
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
  let access: ProcedureEditorAccess | null;
  try { access = memoryOnly ? memoryAccess : JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as ProcedureEditorAccess | null; }
  catch { access = memoryAccess; }
  if (!access || typeof access.pin !== 'string' || access.pin.length < 1 || access.pin.length > 128 || !Number.isFinite(access.expiresAt) || access.expiresAt <= now || access.clientKey !== clientIdentity()) {
    clearProcedureEditorAccess();
    return null;
  }
  memoryAccess = access;
  scheduleExpiry(access);
  return access;
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
