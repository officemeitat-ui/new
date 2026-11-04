export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "budget_exceeded"
  | "internal"
  | "unavailable";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  rate_limited: 429,
  budget_exceeded: 402,
  internal: 500,
  unavailable: 503,
};

/** Error with a stable code that can be shown to users and mapped to an HTTP status. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const unauthorized = (message = "Bitte melden Sie sich an.") =>
  new AppError("unauthorized", message);
export const forbidden = (message = "Dafür fehlt Ihnen die Berechtigung.") =>
  new AppError("forbidden", message);
export const notFound = (message = "Nicht gefunden.") => new AppError("not_found", message);
export const conflict = (message: string) => new AppError("conflict", message);
export const validationError = (message: string) => new AppError("validation", message);
export const unavailable = (message: string) => new AppError("unavailable", message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
