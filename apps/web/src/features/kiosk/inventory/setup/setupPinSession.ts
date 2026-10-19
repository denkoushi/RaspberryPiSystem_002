const PIN_TTL_MS = 5 * 60 * 1000;
let remembered: { pin: string; usedAt: number } | null = null;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export function clearSetupPin() {
  generation += 1;
  remembered = null;
  clearTimeout(timer);
  listeners.forEach((listener) => listener());
}

export function readSetupPin(): string | null {
  if (remembered && Date.now() - remembered.usedAt >= PIN_TTL_MS) clearSetupPin();
  return remembered?.pin ?? null;
}

export function rememberSetupPin(pin: string) {
  remembered = { pin, usedAt: Date.now() };
  clearTimeout(timer);
  timer = setTimeout(clearSetupPin, PIN_TTL_MS);
}

export function touchSetupPin() {
  const pin = readSetupPin();
  if (pin) rememberSetupPin(pin);
}

export function subscribeSetupLock(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type SetupPinSession = { pin: string; generation: number };

export function captureSetupPinSession(pin: string): SetupPinSession {
  return { pin, generation };
}

function isCurrentSession(session: SetupPinSession) {
  return readSetupPin() === session.pin && generation === session.generation;
}

/** Check at invocation, including when React Query resumes an offline request. */
export async function sendSetupRequest<T>(session: SetupPinSession, request: () => Promise<T>): Promise<T> {
  if (!isCurrentSession(session)) throw new Error('ロックされています');
  try {
    return await request();
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if ((status === 401 || status === 403) && isCurrentSession(session)) clearSetupPin();
    throw error;
  }
}
