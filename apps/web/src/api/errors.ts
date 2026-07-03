import axios from 'axios';

type ApiErrorPayload = {
  message?: unknown;
  error?: unknown;
};

function extractResponseMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const payload = data as ApiErrorPayload;
  if (typeof payload.message === 'string' && payload.message) {
    return payload.message;
  }
  if (typeof payload.error === 'string' && payload.error) {
    return payload.error;
  }
  if (payload.error && typeof payload.error === 'object') {
    const nested = payload.error as { message?: unknown };
    if (typeof nested.message === 'string' && nested.message) {
      return nested.message;
    }
  }
  return undefined;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const serverMessage = extractResponseMessage(error.response?.data);
    if (serverMessage) {
      return serverMessage;
    }
    if (error.message) {
      return error.message;
    }
    return fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
