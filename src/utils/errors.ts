export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SLOT_UNAVAILABLE"
  | "INVALID_STATUS_TRANSITION"
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

  constructor(code: ErrorCode, httpStatus: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
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

  static invalidStatusTransition(message = "Perubahan status tidak diizinkan"): AppError {
    return new AppError("INVALID_STATUS_TRANSITION", 409, message);
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: ErrorDetail[] };
}

export function toErrorBody(error: AppError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}
