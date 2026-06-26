import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  CONTRACT_OBLIGATION_STATUSES,
  ContractObligationStatus,
} from "../domain/contract-obligation.types";
import {
  ContractObligationNotFoundError,
  ContractObligationValidationError,
  ContractRegistryPermissionScopeError,
} from "../domain/contract-registry.errors";
import { ContractObligationReadRepository } from "../read/contract-obligation.read-repository";
import {
  GetContractObligationDetailQuery,
  GetContractObligationDetailResult,
  ListContractObligationsQuery,
  ListContractObligationsResult,
} from "../shared/contract-obligation.contracts";

export class ContractObligationAdminQueryService {
  constructor(
    private readonly repository: ContractObligationReadRepository,
  ) {}

  async list(
    actor: Actor,
    query: ListContractObligationsQuery,
  ): Promise<ListContractObligationsResult> {
    this.assertRead(actor);
    return this.repository.listByContractRecordId({
      contractRecordId: requiredText(
        query.contractRecordId,
        "contractRecordId",
      ),
      status: parseStatus(query.status),
      limit: parseLimit(query.limit),
      cursor: optionalText(query.cursor),
    });
  }

  async get(
    actor: Actor,
    query: GetContractObligationDetailQuery,
  ): Promise<GetContractObligationDetailResult> {
    this.assertRead(actor);
    const obligationId = requiredText(
      query.obligationId,
      "obligationId",
    );
    const detail = await this.repository.getDetail(
      obligationId,
    );
    if (!detail) {
      throw new ContractObligationNotFoundError(
        obligationId,
      );
    }
    return detail;
  }

  private assertRead(actor: Actor): void {
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(
      actor,
      PermissionResolver.resolve(
        Permission.CONTRACT_OBLIGATION_READ,
      ),
    );
    if (
      !PermissionGuard.hasContractRegistryScopeGrant(
        actor,
        "global",
      )
    ) {
      throw new ContractRegistryPermissionScopeError(
        "Contract obligation reads require global Contract Registry scope",
      );
    }
  }
}

function parseStatus(
  value: unknown,
): ContractObligationStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ContractObligationValidationError(
      `status must be one of ${CONTRACT_OBLIGATION_STATUSES.join(", ")}`,
    );
  }
  const normalized =
    value.trim().toUpperCase() as ContractObligationStatus;
  if (!CONTRACT_OBLIGATION_STATUSES.includes(normalized)) {
    throw new ContractObligationValidationError(
      `status must be one of ${CONTRACT_OBLIGATION_STATUSES.join(", ")}`,
    );
  }
  return normalized;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 20;
  }
  const parsed =
    typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ContractObligationValidationError(
      "limit must be a positive integer",
    );
  }
  return Math.min(parsed, 100);
}

function requiredText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (!normalized) {
    throw new ContractObligationValidationError(
      `${field} is required`,
    );
  }
  return normalized;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ContractObligationValidationError(
      "Expected string value",
    );
  }
  const normalized = value.trim();
  return normalized || undefined;
}
