import { SystemInvariantError } from "@core/error/system-error";

export class ExposureViolationError extends SystemInvariantError {
  constructor(message: string) {
    super("SYSTEM_INVARIANT_VIOLATION", message);
  }
}
