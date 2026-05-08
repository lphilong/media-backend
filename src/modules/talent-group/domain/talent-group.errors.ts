import { DomainError } from "@core/errors/domain.error";

export class TalentGroupValidationError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_GROUP_VALIDATION_ERROR",
      message,
      "Invalid talent group payload",
      400,
    );
  }
}

export class TalentGroupNotFoundError extends DomainError {
  constructor(groupId: string) {
    super(
      "TALENT_GROUP_NOT_FOUND",
      `Talent group not found: ${groupId}`,
      "Talent group not found",
      404,
    );
  }
}

export class TalentGroupMemberNotFoundError extends DomainError {
  constructor(membershipId: string) {
    super(
      "TALENT_GROUP_MEMBER_NOT_FOUND",
      `Talent group member not found: ${membershipId}`,
      "Talent group member not found",
      404,
    );
  }
}

export class TalentGroupConflictError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_GROUP_CONFLICT_ERROR",
      message,
      "Talent group conflict",
      409,
    );
  }
}

export class TalentGroupStateError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_GROUP_STATE_ERROR",
      message,
      "Invalid talent group state transition",
      409,
    );
  }
}

export class TalentGroupInvalidTalentReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_GROUP_INVALID_TALENT_REFERENCE",
      message,
      "Talent group talent reference is invalid",
      409,
    );
  }
}

export class TalentGroupInvalidMembershipStateError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_GROUP_INVALID_MEMBERSHIP_STATE",
      message,
      "Talent group membership state is invalid",
      409,
    );
  }
}
