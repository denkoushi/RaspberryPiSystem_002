import { isAxiosError } from 'axios';

/** Offline outboxes keep a request and send it again later on these failures: no response, 408, 429, or 5xx. */
export function isRetryableHttpError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 408 || status === 429 || (status >= 500 && status < 600);
}
