export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export type ErrorInfo = {
  name?: string;
  message?: string;
  code?: unknown;
  status?: unknown;
  meta?: unknown;
};

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const base: ErrorInfo = {
      name: error.name,
      message: error.message,
    };
    if (isRecord(error)) {
      base.code = error.code;
      base.status = error.status;
      base.meta = error.meta;
    }
    return base;
  }

  if (isRecord(error)) {
    return {
      name: typeof error.name === 'string' ? error.name : undefined,
      message: typeof error.message === 'string' ? error.message : String(error),
      code: error.code,
      status: error.status,
      meta: error.meta,
    };
  }

  return {
    message: String(error),
  };
}
