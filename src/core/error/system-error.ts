export type SystemErrorCode =
  | "ACTOR_MISSING"
  | "ACTOR_ALREADY_BOUND"
  | "ACTOR_NOT_BOUND"
  | "ACTOR_INACTIVE"
  | "ACTOR_INVALID_PAYLOAD"
  | "CONTEXT_MISSING"
  | "CONTEXT_INVALID"
  | "CONTEXT_ALREADY_BOUND"
  | "CONTEXT_NOT_BOUND"
  | "CONTEXT_VIOLATION"
  | "AUDIT_LOG_FAILED"
  | "PERMISSION_DENIED"
  | "PERMISSION_CONTRACT_MISSING"
  | "PERMISSION_CONTEXT_VIOLATION"
  | "PERMISSION_AUDIT_MAPPING_MISSING"
  | "SYSTEM_INVARIANT_VIOLATION"
  | "PRESENTER_NOT_REGISTERED"
  | "HTTP_PRESENTATION_CONTRACT_VIOLATION"
  | "HTTP_ERROR_CONTRACT_VIOLATION"
  | "HTTP_RESPONSE_SIDE_WRITE_FORBIDDEN"
  | "EXPOSURE_CONTEXT_MISSING"
  | "RAW_HTTP_RESPONSE_DETECTED"
  | "AUDIT_LOG_MISSING"
  | "MONGO_CLIENT_MISSING"
  | "QUEUE_ENQUEUE_FAILED"
  | "HTTP_CONTEXT_NOT_AVAILABLE"
  | "DOMAIN_EVENT_CONTEXT_MISSING"
  | "INVALID_SYSTEM_CONTEXT"
  | "MONGO_CONTEXT_MISSING"
  | "SYSTEM_ACTOR_ID_MISSING"
  | "HTTP_ACTOR_ID_MISSING"
  | "WORKER_CONTEXT_REQUIRED"
  | "AUDIT_CONTEXT_MISSING"
  | "ACTOR_SNAPSHOT_INVALIDATION_FAILED"
  | "AUDIT_ATTEMPT_CONTEXT_MISSING"
  ;

/**
 * SystemInvariantError
 * Thrown when a core security invariant is violated.
 * Must NEVER be caught and ignored silently.
 */
export class SystemInvariantError extends Error {
  readonly code: SystemErrorCode;
  readonly isSystemInvariant = true;

  constructor(code: SystemErrorCode, message: string) {
    super(message);
    this.code = code;

    // Restore prototype chain (important for instanceof)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
