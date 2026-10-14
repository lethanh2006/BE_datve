/** Mã lỗi SQLSTATE của PostgreSQL thường gặp. */
export const PgError = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
} as const;

interface PgLikeError {
  code?: string;
  constraint?: string;
  driverError?: { code?: string; constraint?: string };
}

export function pgErrorCode(e: unknown): string | undefined {
  const err = e as PgLikeError;
  return err?.driverError?.code ?? err?.code;
}

export function pgConstraint(e: unknown): string | undefined {
  const err = e as PgLikeError;
  return err?.driverError?.constraint ?? err?.constraint;
}
