import crypto from 'node:crypto';

import { ApiError } from './errors.js';

export type OAuthStateProvider = 'dropbox' | 'gmail';

const STATE_VERSION = 1;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

type OAuthStatePayload = {
  v: typeof STATE_VERSION;
  p: OAuthStateProvider;
  n: string;
  iat: number;
};

const toBase64Url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

const signPayload = (payload: string, secret: string): string =>
  crypto.createHmac('sha256', secret).update(payload).digest('base64url');

const timingSafeEqualString = (a: string, b: string): boolean => {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
};

const invalidState = (): never => {
  throw new ApiError(400, 'OAuth state is invalid', undefined, 'OAUTH_STATE_INVALID');
};

export function createOAuthState(
  provider: OAuthStateProvider,
  secret: string,
  nowMs = Date.now()
): string {
  const payload: OAuthStatePayload = {
    v: STATE_VERSION,
    p: provider,
    n: crypto.randomBytes(16).toString('hex'),
    iat: nowMs,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifyOAuthState(
  state: string | undefined,
  provider: OAuthStateProvider,
  secret: string,
  options: { nowMs?: number; ttlMs?: number } = {}
): void {
  if (!state) {
    throw new ApiError(400, 'OAuth state is required', undefined, 'OAUTH_STATE_REQUIRED');
  }

  const [encodedPayload, signature, extra] = state.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    invalidState();
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    invalidState();
  }

  let payload: OAuthStatePayload | undefined;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8')) as OAuthStatePayload;
  } catch {
    invalidState();
  }

  const parsedPayload = payload;
  if (!parsedPayload) {
    throw new ApiError(400, 'OAuth state is invalid', undefined, 'OAUTH_STATE_INVALID');
  }

  if (
    parsedPayload.v !== STATE_VERSION ||
    parsedPayload.p !== provider ||
    typeof parsedPayload.n !== 'string' ||
    parsedPayload.n.length < 16 ||
    typeof parsedPayload.iat !== 'number' ||
    !Number.isFinite(parsedPayload.iat)
  ) {
    invalidState();
  }

  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (parsedPayload.iat > nowMs + MAX_CLOCK_SKEW_MS) {
    invalidState();
  }
  if (nowMs - parsedPayload.iat > ttlMs) {
    throw new ApiError(400, 'OAuth state is expired', undefined, 'OAUTH_STATE_EXPIRED');
  }
}
