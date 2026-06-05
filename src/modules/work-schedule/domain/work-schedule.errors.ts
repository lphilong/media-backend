import { DomainError } from "@core/errors/domain.error";

export class WorkScheduleValidationError extends DomainError {
  constructor(message: string) {
    super(
      "WORK_SCHEDULE_VALIDATION_ERROR",
      message,
      "Invalid work schedule payload",
      400,
    );
  }
}

export class WorkScheduleNotFoundError extends DomainError {
  constructor(workShiftId: string) {
    super(
      "WORK_SCHEDULE_NOT_FOUND",
      `Work shift not found: ${workShiftId}`,
      "Work shift not found",
      404,
    );
  }
}

export class WorkScheduleRequestNotFoundError extends DomainError {
  constructor(requestId: string) {
    super(
      "WORK_SCHEDULE_REQUEST_NOT_FOUND",
      `Work schedule request not found: ${requestId}`,
      "Work schedule request not found",
      404,
    );
  }
}

export class WorkScheduleRequestBatchNotFoundError extends DomainError {
  constructor(batchId: string) {
    super(
      "WORK_SCHEDULE_REQUEST_BATCH_NOT_FOUND",
      `Work schedule request batch not found: ${batchId}`,
      "Work schedule request batch not found",
      404,
    );
  }
}

export class WorkScheduleConflictError extends DomainError {
  constructor(message: string) {
    super(
      "WORK_SCHEDULE_CONFLICT_ERROR",
      message,
      "Work schedule conflict",
      409,
    );
  }
}

export class WorkScheduleStateError extends DomainError {
  constructor(message: string) {
    super(
      "WORK_SCHEDULE_STATE_ERROR",
      message,
      "Invalid work schedule state transition",
      409,
    );
  }
}

export class WorkScheduleInvalidSubjectReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "WORK_SCHEDULE_INVALID_SUBJECT_REFERENCE",
      message,
      "Work schedule subject reference is invalid",
      409,
    );
  }
}

export class WorkScheduleInvalidResourceReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "WORK_SCHEDULE_INVALID_RESOURCE_REFERENCE",
      message,
      "Work schedule resource reference is invalid",
      409,
    );
  }
}

export class WorkScheduleOverlapConflictError extends DomainError {
  constructor(message: string) {
    super(
      "WORK_SCHEDULE_OVERLAP_CONFLICT",
      message,
      "Work schedule overlap conflict",
      409,
    );
  }
}

export class WorkSchedulePermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "WORK_SCHEDULE_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
