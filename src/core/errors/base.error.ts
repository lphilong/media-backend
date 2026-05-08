export abstract class BaseAppError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly httpStatus: number;
  readonly isOperational = true;

  protected constructor(
    code: string,
    message: string,
    safeMessage: string,
    httpStatus: number,
  ) {
    super(message);
    this.code = code;
    this.safeMessage = safeMessage;
    this.httpStatus = httpStatus;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}
