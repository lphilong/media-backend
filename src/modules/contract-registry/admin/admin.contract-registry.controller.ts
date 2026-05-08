import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { ContractRegistryValidationError } from "@modules/contract-registry/domain/contract-registry.errors";
import { CONTRACT_REGISTRY_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/contract-registry/shared/contract-registry.presenter-keys";
import {
  ActivateContractRecordCommand,
  ArchiveContractRecordCommand,
  AssignContractRecordOwnerCommand,
  CreateContractRecordCommand,
  ExpireContractRecordCommand,
  MarkContractRecordPendingSignatureCommand,
  ReopenContractRecordDraftCommand,
  TerminateContractRecordCommand,
  UpdateContractRecordDraftCoreCommand,
  UpdateContractRecordFileReferenceCommand,
} from "@modules/contract-registry/shared/contract-registry.contracts";
import { ContractRegistryAdminService } from "./admin.contract-registry.service";

type ContractRegistryMutationCommand =
  | "CONTRACT_RECORD_CREATE"
  | "CONTRACT_RECORD_UPDATE_DRAFT_CORE"
  | "CONTRACT_RECORD_ASSIGN_OWNER"
  | "CONTRACT_RECORD_UPDATE_FILE_REFERENCE"
  | "CONTRACT_RECORD_MARK_PENDING_SIGNATURE"
  | "CONTRACT_RECORD_REOPEN_DRAFT"
  | "CONTRACT_RECORD_ACTIVATE"
  | "CONTRACT_RECORD_EXPIRE"
  | "CONTRACT_RECORD_TERMINATE"
  | "CONTRACT_RECORD_ARCHIVE";

const CREATE_CONTRACT_RECORD_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "contractCode",
    "title",
    "contractKind",
    "linkedEntityKind",
    "linkedEmploymentProfileId",
    "linkedTalentId",
    "ownerEmploymentProfileId",
    "confidentialityTier",
    "effectiveStartDate",
    "effectiveEndDate",
    "fileReferenceId",
    "fileDisplayName",
    "description",
    "externalRef",
  ]);

const UPDATE_DRAFT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "linkedEntityKind",
    "linkedEmploymentProfileId",
    "linkedTalentId",
    "confidentialityTier",
    "effectiveStartDate",
    "effectiveEndDate",
    "description",
    "externalRef",
  ]);

const ASSIGN_OWNER_BODY_FIELDS: readonly string[] =
  Object.freeze(["newOwnerEmploymentProfileId"]);

const UPDATE_FILE_REFERENCE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "newFileReferenceId",
    "newFileDisplayName",
  ]);

const EXPIRE_CONTRACT_RECORD_BODY_FIELDS: readonly string[] =
  Object.freeze(["expiryDate"]);

const TERMINATE_CONTRACT_RECORD_BODY_FIELDS: readonly string[] =
  Object.freeze(["terminationDate"]);

export class ContractRegistryAdminController extends SecureController {
  constructor(
    private readonly service: ContractRegistryAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<ContractRegistryMutationCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Contract registry mutation command missing",
      );
    }

    switch (command) {
      case "CONTRACT_RECORD_CREATE":
        return this.service.createContractRecord(
          actor,
          parseCreateContractRecordCommand(req),
        );

      case "CONTRACT_RECORD_UPDATE_DRAFT_CORE":
        return this.service.updateContractRecordDraftCore(
          actor,
          parseUpdateContractRecordDraftCoreCommand(
            req,
          ),
        );

      case "CONTRACT_RECORD_ASSIGN_OWNER":
        return this.service.assignContractRecordOwner(
          actor,
          parseAssignContractRecordOwnerCommand(req),
        );

      case "CONTRACT_RECORD_UPDATE_FILE_REFERENCE":
        return this.service.updateContractRecordFileReference(
          actor,
          parseUpdateContractRecordFileReferenceCommand(
            req,
          ),
        );

      case "CONTRACT_RECORD_MARK_PENDING_SIGNATURE":
        return this.service.markContractRecordPendingSignature(
          actor,
          parseMarkContractRecordPendingSignatureCommand(
            req,
          ),
        );

      case "CONTRACT_RECORD_REOPEN_DRAFT":
        return this.service.reopenContractRecordDraft(
          actor,
          parseReopenContractRecordDraftCommand(req),
        );

      case "CONTRACT_RECORD_ACTIVATE":
        return this.service.activateContractRecord(
          actor,
          parseActivateContractRecordCommand(req),
        );

      case "CONTRACT_RECORD_EXPIRE":
        return this.service.expireContractRecord(
          actor,
          parseExpireContractRecordCommand(req),
        );

      case "CONTRACT_RECORD_TERMINATE":
        return this.service.terminateContractRecord(
          actor,
          parseTerminateContractRecordCommand(req),
        );

      case "CONTRACT_RECORD_ARCHIVE":
        return this.service.archiveContractRecord(
          actor,
          parseArchiveContractRecordCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported contract registry mutation command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(
        CONTRACT_REGISTRY_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateContractRecordCommand(
  req: Request,
): CreateContractRecordCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_CONTRACT_RECORD_BODY_FIELDS,
    "createContractRecord",
  );

  return {
    contractCode: body.contractCode as string,
    title: body.title as string,
    contractKind: body.contractKind as string,
    linkedEntityKind:
      body.linkedEntityKind as string,
    linkedEmploymentProfileId:
      body.linkedEmploymentProfileId as
        | string
        | null
        | undefined,
    linkedTalentId:
      body.linkedTalentId as
        | string
        | null
        | undefined,
    ownerEmploymentProfileId:
      body.ownerEmploymentProfileId as string,
    confidentialityTier:
      body.confidentialityTier as string,
    effectiveStartDate:
      body.effectiveStartDate as string,
    effectiveEndDate:
      body.effectiveEndDate as
        | string
        | null
        | undefined,
    fileReferenceId:
      body.fileReferenceId as
        | string
        | null
        | undefined,
    fileDisplayName:
      body.fileDisplayName as
        | string
        | null
        | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseUpdateContractRecordDraftCoreCommand(
  req: Request,
): UpdateContractRecordDraftCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_DRAFT_CORE_BODY_FIELDS,
    "updateContractRecordDraftCore",
  );

  return {
    contractRecordId: req.params.contractRecordId,
    title: body.title as string | undefined,
    linkedEntityKind:
      body.linkedEntityKind as string | undefined,
    linkedEmploymentProfileId:
      body.linkedEmploymentProfileId as
        | string
        | null
        | undefined,
    linkedTalentId:
      body.linkedTalentId as
        | string
        | null
        | undefined,
    confidentialityTier:
      body.confidentialityTier as
        | string
        | undefined,
    effectiveStartDate:
      body.effectiveStartDate as
        | string
        | undefined,
    effectiveEndDate:
      body.effectiveEndDate as
        | string
        | null
        | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseAssignContractRecordOwnerCommand(
  req: Request,
): AssignContractRecordOwnerCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    ASSIGN_OWNER_BODY_FIELDS,
    "assignContractRecordOwner",
  );

  return {
    contractRecordId: req.params.contractRecordId,
    newOwnerEmploymentProfileId:
      body.newOwnerEmploymentProfileId as string,
  };
}

function parseUpdateContractRecordFileReferenceCommand(
  req: Request,
): UpdateContractRecordFileReferenceCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_FILE_REFERENCE_BODY_FIELDS,
    "updateContractRecordFileReference",
  );

  return {
    contractRecordId: req.params.contractRecordId,
    newFileReferenceId:
      body.newFileReferenceId as string | null,
    newFileDisplayName:
      body.newFileDisplayName as string | null,
  };
}

function parseMarkContractRecordPendingSignatureCommand(
  req: Request,
): MarkContractRecordPendingSignatureCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "markContractRecordPendingSignature",
  );

  return {
    contractRecordId: req.params.contractRecordId,
  };
}

function parseReopenContractRecordDraftCommand(
  req: Request,
): ReopenContractRecordDraftCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "reopenContractRecordDraft",
  );

  return {
    contractRecordId: req.params.contractRecordId,
  };
}

function parseActivateContractRecordCommand(
  req: Request,
): ActivateContractRecordCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "activateContractRecord",
  );

  return {
    contractRecordId: req.params.contractRecordId,
  };
}

function parseExpireContractRecordCommand(
  req: Request,
): ExpireContractRecordCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    EXPIRE_CONTRACT_RECORD_BODY_FIELDS,
    "expireContractRecord",
  );

  return {
    contractRecordId: req.params.contractRecordId,
    expiryDate: body.expiryDate as string,
  };
}

function parseTerminateContractRecordCommand(
  req: Request,
): TerminateContractRecordCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    TERMINATE_CONTRACT_RECORD_BODY_FIELDS,
    "terminateContractRecord",
  );

  return {
    contractRecordId: req.params.contractRecordId,
    terminationDate: body.terminationDate as string,
  };
}

function parseArchiveContractRecordCommand(
  req: Request,
): ArchiveContractRecordCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveContractRecord",
  );

  return {
    contractRecordId: req.params.contractRecordId,
  };
}

function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ContractRegistryValidationError(
      "Request body must be a plain object",
    );
  }

  return value as Record<string, unknown>;
}

function assertNoUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  mutationName: string,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new ContractRegistryValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
