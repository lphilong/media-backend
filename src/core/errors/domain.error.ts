import { BaseAppError } from "./base.error";

export abstract class DomainError extends BaseAppError {
  protected constructor(
    code: string,
    message: string,
    safeMessage: string,
    httpStatus = 400,
  ) {
    super(code, message, safeMessage, httpStatus);
  }
}
