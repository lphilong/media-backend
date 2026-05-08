import { BaseAppError } from "@core/errors";

/**
 * Infrastructure-level operational failure.
 * Never represents business logic violation.
 */
export class InfrastructureError extends BaseAppError {
  constructor(
    code: string,
    message: string,
    safeMessage = "Infrastructure error",
    httpStatus = 500,
  ) {
    super(code, message, safeMessage, httpStatus);
  }
}