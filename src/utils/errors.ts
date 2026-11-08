export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SLOT_UNAVAILABLE"
  | "INVALID_STATUS_TRANSITION"
  | "BLOCK_HAS_BOOKINGS"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  field: string;
  message: string;
}

/** Business error that the error handler turns into the API's error format. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetail[] | undefined;
  /** Extra payload for BLOCK_HAS_BOOKINGS: the bookings that stand in the way. */
  readonly conflicts: readonly unknown[] | undefined;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    details?: ErrorDetail[],
    conflicts?: readonly unknown[],
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.conflicts = conflicts;
  }

  static validation(details?: ErrorDetail[], message = "Input tidak valid"): AppError {
    return new AppError("VALIDATION_ERROR", 422, message, details);
  }

  static unauthorized(message = "Token tidak ada atau tidak valid"): AppError {
    return new AppError("UNAUTHORIZED", 401, message);
  }

  static forbidden(message = "Anda tidak memiliki akses"): AppError {
    return new AppError("FORBIDDEN", 403, message);
  }

  static notFound(message = "Data tidak ditemukan"): AppError {
    return new AppError("NOT_FOUND", 404, message);
  }

  static slotUnavailable(message = "Jadwal yang dipilih sudah tidak tersedia"): AppError {
    return new AppError("SLOT_UNAVAILABLE", 409, message);
  }

  static blockHasBookings(
    conflicts: readonly unknown[],
    message = "Ada reservasi pada waktu yang akan diblokir",
  ): AppError {
    return new AppError("BLOCK_HAS_BOOKINGS", 409, message, undefined, conflicts);
  }

  static invalidStatusTransition(message = "Perubahan status tidak diizinkan"): AppError {
    return new AppError("INVALID_STATUS_TRANSITION", 409, message);
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: ErrorDetail[]; conflicts?: readonly unknown[] };
}

export function toErrorBody(error: AppError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.conflicts ? { conflicts: error.conflicts } : {}),
    },
  };
}
