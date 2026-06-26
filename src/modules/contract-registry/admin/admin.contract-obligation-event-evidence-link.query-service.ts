import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_STATUSES,
  ContractObligationEventEvidenceLinkStatus,
} from "../domain/contract-obligation-event-evidence-link.types";
import {
  ContractObligationValidationError,
  ContractRegistryPermissionScopeError,
} from "../domain/contract-registry.errors";
import { ContractObligationEventEvidenceLinkReadRepository } from "../read/contract-obligation-event-evidence-link.read-repository";
import {
  GetContractObligationEventEvidenceLinkDetailQuery,
  GetContractObligationEventEvidenceLinkDetailResult,
  ListContractObligationEventEvidenceLinksQuery,
  ListContractObligationEventEvidenceLinksResult,
} from "../shared/contract-obligation-event-evidence-link.contracts";

export class ContractObligationEventEvidenceLinkAdminQueryService {
  constructor(
    private readonly repository: ContractObligationEventEvidenceLinkReadRepository,
  ) {}

  async list(
    actor: Actor,
    query: ListContractObligationEventEvidenceLinksQuery,
  ): Promise<ListContractObligationEventEvidenceLinksResult> {
    this.assertRead(actor);
    return this.repository.listByObligationId({
      contractObligationId: requiredText(
        query.contractObligationId,
        "contractObligationId",
      ),
      status: parseStatus(query.status),
      limit: parseLimit(query.limit),
      cursor: optionalText(query.cursor),
    });
  }

  async get(
    actor: Actor,
    query: GetContractObligationEventEvidenceLinkDetailQuery,
  ): Promise<GetContractObligationEventEvidenceLinkDetailResult> {
    this.assertRead(actor);
    const linkId = requiredText(query.linkId, "linkId");
    const detail = await this.repository.getDetail(linkId);
    if (!detail) {
      throw new ContractObligationValidationError(
        `Contract obligation event evidence link not found: ${linkId}`,
      );
    }
    return detail;
  }

  private assertRead(actor: Actor): void {
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(
      actor,
      PermissionResolver.resolve(
        Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
      ),
    );
    if (
      !PermissionGuard.hasContractRegistryScopeGrant(
        actor,
        "global",
      )
    ) {
      throw new ContractRegistryPermissionScopeError(
        "Contract obligation event evidence link reads require global Contract Registry scope",
      );
    }
  }
}

function parseStatus(
  value: unknown,
): ContractObligationEventEvidenceLinkStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ContractObligationValidationError(
      `status must be one of ${CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_STATUSES.join(", ")}`,
    );
  }
  const normalized =
    value
      .trim()
      .toUpperCase() as ContractObligationEventEvidenceLinkStatus;
  if (
    !CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_STATUSES.includes(
      normalized,
    )
  ) {
    throw new ContractObligationValidationError(
      `status must be one of ${CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_STATUSES.join(", ")}`,
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
