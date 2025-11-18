export class ApiError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export function assert(condition: unknown, statusCode: number, message: string): asserts condition {
  if (!condition) {
    throw new ApiError(statusCode, message);
  }
}
