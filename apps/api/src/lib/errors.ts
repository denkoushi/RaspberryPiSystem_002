export class ApiError extends Error {
  public details?: unknown;
  public code?: string;

  constructor(public statusCode: number, message: string, details?: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.details = details;

    if (code) {
      this.code = code;
      return;
    }

    if (details && typeof details === 'object' && 'code' in details) {
      this.code = String((details as Record<string, unknown>).code);
    }
  }
}

export function assert(condition: unknown, statusCode: number, message: string): asserts condition {
  if (!condition) {
    throw new ApiError(statusCode, message);
  }
}
