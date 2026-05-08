/**
 * Error shape returned to client.
 * MUST be stable & documented.
 */
export type HttpErrorDetailPrimitive =
  | string
  | number
  | boolean
  | null;

export type HttpErrorDetailValue =
  | HttpErrorDetailPrimitive
  | readonly HttpErrorDetailPrimitive[];

export type HttpErrorDetails = Readonly<
  Record<string, HttpErrorDetailValue>
>;

export interface HttpErrorResponse {
  readonly error: {
    code: string;
    message: string;
    details?: HttpErrorDetails;
  };
  readonly meta?: {
    requestId: string;
  };
}

/**
 * Internal HTTP error representation.
 * Used ONLY in HTTP layer.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: HttpErrorDetails;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: HttpErrorDetails,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}
