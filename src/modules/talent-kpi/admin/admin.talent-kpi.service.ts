import crypto from "crypto";
import {
  ClientSession,
  MongoServerError,
} from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { utcMonthBucketFromTimestamp } from "@core/business-code/business-code-bucket";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { BaseAppError } from "@core/errors/base.error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { EventStatus } from "@modules/event-assignment/domain/event-assignment.types";
import { TalentKpiEventReadonlyAccess } from "@modules/talent-kpi/domain/talent-kpi-event-readonly-access";
import {
  TalentKpiConflictError,
  TalentKpiInvalidEventAttributionError,
  TalentKpiInvalidMetricValueError,
  TalentKpiInvalidPlatformAttributionError,
  TalentKpiInvalidTalentReferenceError,
  TalentKpiNotFoundError,
  TalentKpiPermissionScopeError,
  TalentKpiStateError,
  TalentKpiValidationError,
} from "@modules/talent-kpi/domain/talent-kpi.errors";
import { buildTalentKpiCodePolicy } from "@modules/talent-kpi/domain/talent-kpi-code-policy";
import { TalentKpiPlatformAccountReadonlyAccess } from "@modules/talent-kpi/domain/talent-kpi-platform-account-readonly-access";
import {
  TalentKpiMeasurementIdentity,
  TalentKpiRepository,
} from "@modules/talent-kpi/domain/talent-kpi.repository";
import { TalentKpiTalentReadonlyAccess } from "@modules/talent-kpi/domain/talent-kpi-talent-readonly-access";
import {
  TALENT_KPI_MEASUREMENT_SOURCES,
  TALENT_KPI_METRIC_CODES,
  TalentKpiMeasurementSource,
  TalentKpiMetricCode,
  TalentKpiMetricValue,
  TalentKpiRecord,
  TalentKpiRecordMutationView,
} from "@modules/talent-kpi/domain/talent-kpi.types";
import {
  ArchiveTalentKpiRecordCommand,
  CreateTalentKpiRecordCommand,
  FinalizeTalentKpiRecordCommand,
  ReplaceTalentKpiMetricsCommand,
  TalentKpiMetricInput,
  TalentKpiRecordMutationResult,
  UpdateTalentKpiDraftCoreCommand,
} from "@modules/talent-kpi/shared/talent-kpi.contracts";

const METRIC_CODES_REQUIRING_NON_NEGATIVE_DECIMAL =
  new Set<TalentKpiMetricCode>([
    "LIVESTREAM_HOURS",
    "REVENUE_ATTRIBUTED_AMOUNT",
  ]);

const METRIC_CODES_REQUIRING_NON_NEGATIVE_INTEGER =
  new Set<TalentKpiMetricCode>([
    "LIVESTREAM_SESSION_COUNT",
    "CONTENT_PUBLISH_COUNT",
    "EVENT_APPEARANCE_COUNT",
    "ENGAGEMENT_COUNT",
  ]);

const EVENT_STATUSES_ALLOWED_FOR_ATTRIBUTION =
  new Set<EventStatus>([
    "PLANNED",
    "CONFIRMED",
    "COMPLETED",
  ]);

type TalentKpiMutationFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_talent_reference"
  | "invalid_platform_attribution"
  | "invalid_event_attribution"
  | "invalid_metric_value"
  | "permission_scope"
  | "invariant"
  | "unknown";

interface NormalizedMetricValue {
  readonly metricCode: TalentKpiMetricCode;
  readonly numericValue: number;
  readonly canonicalNumericValue: string;
}

interface NormalizedCreateCommand {
  readonly kpiRecordCode: string | undefined;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly measurementSource: TalentKpiMeasurementSource;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly metrics: readonly NormalizedMetricValue[];
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateDraftCoreCommand {
  readonly talentKpiRecordId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly periodStartAt?: number;
  readonly periodEndAt?: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

interface NormalizedReplaceMetricsCommand {
  readonly talentKpiRecordId: string;
  readonly metrics: readonly NormalizedMetricValue[];
}

interface NormalizedLifecycleCommand {
  readonly talentKpiRecordId: string;
}

interface TalentKpiCandidateState
  extends TalentKpiMeasurementIdentity {}

interface DraftCorePatchBuildResult {
  readonly update: {
    title?: string;
    normalizedTitle?: string;
    subjectTalentId?: string;
    attributionPlatformAccountId?: string | null;
    attributionEventId?: string | null;
    periodStartAt?: number;
    periodEndAt?: number;
    description?: string | null;
    externalRef?: string | null;
  };
  readonly candidate: TalentKpiCandidateState;
  readonly changedFields: readonly string[];
}

export class TalentKpiAdminService {
  constructor(
    private readonly repository: TalentKpiRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly talentReadonlyAccess: TalentKpiTalentReadonlyAccess,
    private readonly platformAccountReadonlyAccess: TalentKpiPlatformAccountReadonlyAccess,
    private readonly eventReadonlyAccess: TalentKpiEventReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createTalentKpiRecord(
    actor: Actor,
    command: CreateTalentKpiRecordCommand,
  ): Promise<TalentKpiRecordMutationResult> {
    const operation = "talent-kpi.create";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_KPI_CREATE,
    );
    const input = normalizeCreateCommand(command);

    try {
      return await this.executeMutation(
        actor,
        permission,
        operation,
        {
          kpiRecordCode: readOptionalLogString(
            command.kpiRecordCode,
          ),
          subjectTalentId: input.subjectTalentId,
          attributionPlatformAccountId:
            input.attributionPlatformAccountId,
          attributionEventId:
            input.attributionEventId,
          measurementSource:
            input.measurementSource,
        },
        async (session) => {
          const scope = resolveRequiredGlobalScope(
            actor,
          );

          if (input.kpiRecordCode !== undefined) {
            const existingByCode =
              await this.repository.findRecordByKpiRecordCode(
                input.kpiRecordCode,
                session,
              );

            if (existingByCode) {
              throw new TalentKpiConflictError(
                `KPI record code already exists: ${input.kpiRecordCode}`,
              );
            }
          }

          const candidate: TalentKpiCandidateState = {
            subjectTalentId: input.subjectTalentId,
            attributionPlatformAccountId:
              input.attributionPlatformAccountId,
            attributionEventId:
              input.attributionEventId,
            measurementSource:
              input.measurementSource,
            periodStartAt: input.periodStartAt,
            periodEndAt: input.periodEndAt,
          };

          await this.assertCandidateStateValid(
            candidate,
            session,
          );

          let record!: TalentKpiRecord;
          const maxAttempts =
            input.kpiRecordCode === undefined ? 5 : 1;

          for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt += 1
          ) {
            const kpiRecordCode =
              input.kpiRecordCode ??
              (await this.allocateGeneratedCode(
                input.periodStartAt,
                session,
              ));
            const now = Date.now();
            record = {
              id: crypto.randomUUID(),
              kpiRecordCode,
              normalizedKpiRecordCode:
                canonicalizeSearchToken(
                  kpiRecordCode,
                ),
              title: input.title,
              normalizedTitle:
                input.normalizedTitle,
              subjectTalentId:
                input.subjectTalentId,
              attributionPlatformAccountId:
                input.attributionPlatformAccountId,
              attributionEventId:
                input.attributionEventId,
              measurementSource:
                input.measurementSource,
              status: "DRAFT",
              periodStartAt: input.periodStartAt,
              periodEndAt: input.periodEndAt,
              publishedAt: null,
              description: input.description,
              externalRef: input.externalRef,
              createdAt: now,
              updatedAt: now,
            };

            const metricValues = toMetricValueRecords(
              record.id,
              input.metrics,
              now,
            );

            try {
              await this.repository.insertRecord(
                record,
                session,
              );
              await this.repository.insertMetricValues(
                metricValues,
                session,
              );
              break;
            } catch (error) {
              if (!isDuplicateKeyError(error)) {
                throw error;
              }

              if (input.kpiRecordCode !== undefined) {
                throw new TalentKpiConflictError(
                  "KPI record code or measurement identity already exists",
                );
              }

              if (attempt >= maxAttempts) {
                throw new TalentKpiConflictError(
                  "Generated KPI record code conflict detected on create",
                );
              }
            }
          }

          await this.recordAudit({
            actor,
            permission,
            talentKpiRecordId: record.id,
            mutationType: operation,
            metadata: {
              status: record.status,
              subjectTalentId:
                record.subjectTalentId,
              attributionPlatformAccountId:
                record.attributionPlatformAccountId,
              attributionEventId:
                record.attributionEventId,
              periodStartAt: record.periodStartAt,
              periodEndAt: record.periodEndAt,
              metricSet: toMetricAuditView(
                input.metrics,
              ),
              effectiveScope: scope,
            },
            session,
          });

          return toTalentKpiRecordMutationView(record);
        },
        (result) => ({
          talentKpiRecordId: result.id,
          status: result.status,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new TalentKpiConflictError(
          "KPI record code or measurement identity already exists",
        );
      }

      throw error;
    }
  }

  async updateTalentKpiDraftCore(
    actor: Actor,
    command: UpdateTalentKpiDraftCoreCommand,
  ): Promise<TalentKpiRecordMutationResult> {
    const operation = "talent-kpi.update-draft-core";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_KPI_UPDATE,
    );
    const input =
      normalizeUpdateDraftCoreCommand(command);

    try {
      return await this.executeMutation(
        actor,
        permission,
        operation,
        {
          talentKpiRecordId: input.talentKpiRecordId,
        },
        async (session) => {
          const scope = resolveRequiredGlobalScope(
            actor,
          );
          const current =
            await this.requireTalentKpiRecord(
              input.talentKpiRecordId,
              session,
            );

          if (current.status !== "DRAFT") {
            throw new TalentKpiStateError(
              `updateTalentKpiDraftCore is allowed only while record is DRAFT: ${current.id}`,
            );
          }

          const patch = buildDraftCorePatch(
            current,
            input,
          );

          await this.assertCandidateStateValid(
            patch.candidate,
            session,
            current.id,
          );

          const updated =
            await this.repository.updateDraftCore(
              {
                talentKpiRecordId: current.id,
                ...patch.update,
                updatedAt: Date.now(),
              },
              session,
            );

          if (!updated) {
            throw new TalentKpiStateError(
              `updateTalentKpiDraftCore failed because record is no longer mutable in current state: ${current.id}`,
            );
          }

          await this.recordAudit({
            actor,
            permission,
            talentKpiRecordId: updated.id,
            mutationType: operation,
            metadata: {
              changedFields: patch.changedFields,
              subjectTalentId:
                updated.subjectTalentId,
              attributionPlatformAccountId:
                updated.attributionPlatformAccountId,
              attributionEventId:
                updated.attributionEventId,
              periodStartAt: updated.periodStartAt,
              periodEndAt: updated.periodEndAt,
              ...buildDraftCoreAuditDelta(
                current,
                updated,
                patch.changedFields,
              ),
              effectiveScope: scope,
            },
            session,
          });

          return toTalentKpiRecordMutationView(updated);
        },
        (result) => ({
          talentKpiRecordId: result.id,
          status: result.status,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new TalentKpiConflictError(
          "Measurement identity already exists for a non-archived KPI record",
        );
      }

      throw error;
    }
  }

  async replaceTalentKpiMetrics(
    actor: Actor,
    command: ReplaceTalentKpiMetricsCommand,
  ): Promise<TalentKpiRecordMutationResult> {
    const operation = "talent-kpi.replace-metrics";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_KPI_MANAGE_METRICS,
    );
    const input =
      normalizeReplaceMetricsCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentKpiRecordId: input.talentKpiRecordId,
        metricCount: input.metrics.length,
      },
      async (session, controls) => {
        const scope = resolveRequiredGlobalScope(
          actor,
        );
        const current =
          await this.requireTalentKpiRecord(
            input.talentKpiRecordId,
            session,
          );

        if (current.status !== "DRAFT") {
          throw new TalentKpiStateError(
            `replaceTalentKpiMetrics is allowed only while record is DRAFT: ${current.id}`,
          );
        }

        const currentMetrics =
          await this.repository.listMetricValuesByRecordId(
            current.id,
            session,
          );
        const canonicalCurrent =
          normalizeStoredMetricSet(currentMetrics);
        const canonicalReplacement =
          input.metrics;

        if (
          areCanonicalMetricSetsEqual(
            canonicalCurrent,
            canonicalReplacement,
          )
        ) {
          controls.markExplicitNoOpSuccess();
          return toTalentKpiRecordMutationView(current);
        }

        const now = Date.now();
        const replacementMetricValues =
          toMetricValueRecords(
            current.id,
            input.metrics,
            now,
          );

        await this.repository.deleteMetricValuesByRecordId(
          current.id,
          session,
        );
        await this.repository.insertMetricValues(
          replacementMetricValues,
          session,
        );

        const touched =
          await this.repository.touchDraftRecord(
            {
              talentKpiRecordId: current.id,
              updatedAt: now,
            },
            session,
          );

        if (!touched) {
          throw new TalentKpiStateError(
            `replaceTalentKpiMetrics failed because record is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentKpiRecordId: touched.id,
          mutationType: operation,
          metadata: {
            previousMetricSet:
              toMetricAuditView(canonicalCurrent),
            nextMetricSet:
              toMetricAuditView(canonicalReplacement),
            effectiveScope: scope,
          },
          session,
        });

        return toTalentKpiRecordMutationView(touched);
      },
      (result) => ({
        talentKpiRecordId: result.id,
        status: result.status,
      }),
    );
  }

  async finalizeTalentKpiRecord(
    actor: Actor,
    command: FinalizeTalentKpiRecordCommand,
  ): Promise<TalentKpiRecordMutationResult> {
    const operation = "talent-kpi.finalize";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_KPI_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentKpiRecordId: input.talentKpiRecordId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(
          actor,
        );
        const current =
          await this.requireTalentKpiRecord(
            input.talentKpiRecordId,
            session,
          );

        if (current.status !== "DRAFT") {
          throw new TalentKpiStateError(
            `finalizeTalentKpiRecord is allowed only while record is DRAFT: ${current.id}`,
          );
        }

        const candidate: TalentKpiCandidateState = {
          subjectTalentId: current.subjectTalentId,
          attributionPlatformAccountId:
            current.attributionPlatformAccountId,
          attributionEventId:
            current.attributionEventId,
          measurementSource:
            current.measurementSource,
          periodStartAt: current.periodStartAt,
          periodEndAt: current.periodEndAt,
        };

        await this.assertCandidateStateValid(
          candidate,
          session,
          current.id,
        );

        const metrics =
          await this.repository.listMetricValuesByRecordId(
            current.id,
            session,
          );
        const canonicalMetrics =
          normalizeStoredMetricSet(metrics);

        if (canonicalMetrics.length === 0) {
          throw new TalentKpiStateError(
            `finalizeTalentKpiRecord requires at least one metric value: ${current.id}`,
          );
        }

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              talentKpiRecordId: current.id,
              fromStatuses: ["DRAFT"],
              toStatus: "FINALIZED",
              publishedAt: now,
              updatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new TalentKpiStateError(
            `finalizeTalentKpiRecord failed because record is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentKpiRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            publishedAt: updated.publishedAt,
            subjectTalentId:
              updated.subjectTalentId,
            attributionPlatformAccountId:
              updated.attributionPlatformAccountId,
            attributionEventId:
              updated.attributionEventId,
            periodStartAt: updated.periodStartAt,
            periodEndAt: updated.periodEndAt,
            metricSet:
              toMetricAuditView(canonicalMetrics),
            effectiveScope: scope,
          },
          session,
        });

        return toTalentKpiRecordMutationView(updated);
      },
      (result) => ({
        talentKpiRecordId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveTalentKpiRecord(
    actor: Actor,
    command: ArchiveTalentKpiRecordCommand,
  ): Promise<TalentKpiRecordMutationResult> {
    const operation = "talent-kpi.archive";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_KPI_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentKpiRecordId: input.talentKpiRecordId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(
          actor,
        );
        const current =
          await this.requireTalentKpiRecord(
            input.talentKpiRecordId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new TalentKpiStateError(
            `archiveTalentKpiRecord is not allowed from ARCHIVED state: ${current.id}`,
          );
        }

        if (
          current.status !== "DRAFT" &&
          current.status !== "FINALIZED"
        ) {
          throw new TalentKpiStateError(
            `archiveTalentKpiRecord is allowed only from DRAFT or FINALIZED state: ${current.id}`,
          );
        }

        const updated =
          await this.repository.transitionStatus(
            {
              talentKpiRecordId: current.id,
              fromStatuses: [
                "DRAFT",
                "FINALIZED",
              ],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentKpiStateError(
            `archiveTalentKpiRecord failed because record is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentKpiRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toTalentKpiRecordMutationView(updated);
      },
      (result) => ({
        talentKpiRecordId: result.id,
        status: result.status,
      }),
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    assertAdminActorType(actor);

    const permission =
      PermissionResolver.resolve(permissionCode);
    PermissionGuard.assert(actor, permission);

    return permission;
  }

  private async requireTalentKpiRecord(
    talentKpiRecordId: string,
    session: ClientSession,
  ): Promise<TalentKpiRecord> {
    const record = await this.repository.findRecordById(
      talentKpiRecordId,
      session,
    );

    if (!record) {
      throw new TalentKpiNotFoundError(
        talentKpiRecordId,
      );
    }

    return record;
  }

  private async allocateGeneratedCode(
    periodStartAt: number,
    session: ClientSession,
  ): Promise<string> {
    const bucket =
      utcMonthBucketFromTimestamp(periodStartAt);
    const policy = buildTalentKpiCodePolicy(bucket);
    const maxExisting =
      await this.repository.findMaxGeneratedKpiRecordCodeSequence(
        policy,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      policy.moduleKey,
      policy.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        policy.moduleKey,
        policy.bucket,
        session,
      );

    return formatBusinessCode(policy, next);
  }

  private async assertCandidateStateValid(
    candidate: TalentKpiCandidateState,
    session: ClientSession,
    excludeTalentKpiRecordId?: string,
  ): Promise<void> {
    const evaluationTime = Date.now();
    assertMeasurementSourceRule(
      candidate.measurementSource,
    );
    assertMeasurementPeriodRule(
      candidate.periodStartAt,
      candidate.periodEndAt,
      evaluationTime,
    );
    await this.assertSubjectTalentResolvable(
      candidate.subjectTalentId,
      session,
    );
    await this.assertPlatformAttributionResolvable(
      candidate.attributionPlatformAccountId,
      session,
    );
    await this.assertEventAttributionValid(
      candidate.attributionEventId,
      candidate.subjectTalentId,
      candidate.attributionPlatformAccountId,
      session,
    );
    await this.assertMeasurementIdentityUnique(
      candidate,
      session,
      excludeTalentKpiRecordId,
    );
  }

  private async assertSubjectTalentResolvable(
    subjectTalentId: string,
    session: ClientSession,
  ): Promise<void> {
    const talent =
      await this.talentReadonlyAccess.findById(
        subjectTalentId,
        session,
      );

    if (talent) {
      return;
    }

    throw new TalentKpiInvalidTalentReferenceError(
      `Subject talent does not exist: ${subjectTalentId}`,
    );
  }

  private async assertPlatformAttributionResolvable(
    attributionPlatformAccountId: string | null,
    session: ClientSession,
  ): Promise<void> {
    if (!attributionPlatformAccountId) {
      return;
    }

    const platformAccount =
      await this.platformAccountReadonlyAccess.findById(
        attributionPlatformAccountId,
        session,
      );

    if (platformAccount) {
      return;
    }

    throw new TalentKpiInvalidPlatformAttributionError(
      `Attributed platform account does not exist: ${attributionPlatformAccountId}`,
    );
  }

  private async assertEventAttributionValid(
    attributionEventId: string | null,
    subjectTalentId: string,
    attributionPlatformAccountId: string | null,
    session: ClientSession,
  ): Promise<void> {
    if (!attributionEventId) {
      return;
    }

    const event = await this.eventReadonlyAccess.findById(
      attributionEventId,
      session,
    );

    if (!event) {
      throw new TalentKpiInvalidEventAttributionError(
        `Attributed event does not exist: ${attributionEventId}`,
      );
    }

    if (
      !EVENT_STATUSES_ALLOWED_FOR_ATTRIBUTION.has(
        event.status,
      )
    ) {
      throw new TalentKpiInvalidEventAttributionError(
        `Attributed event must be PLANNED, CONFIRMED, or COMPLETED: ${attributionEventId}`,
      );
    }

    const hasActiveTalentAssignment =
      await this.eventReadonlyAccess.hasActiveTalentAssignment(
        attributionEventId,
        subjectTalentId,
        session,
      );

    if (!hasActiveTalentAssignment) {
      throw new TalentKpiInvalidEventAttributionError(
        `Attributed event must contain an ACTIVE TALENT assignment for subjectTalentId ${subjectTalentId}: ${attributionEventId}`,
      );
    }

    if (
      attributionPlatformAccountId &&
      !event.platformAccountIds.includes(
        attributionPlatformAccountId,
      )
    ) {
      throw new TalentKpiInvalidEventAttributionError(
        `Attributed event must include platformAccountId ${attributionPlatformAccountId}: ${attributionEventId}`,
      );
    }
  }

  private async assertMeasurementIdentityUnique(
    candidate: TalentKpiMeasurementIdentity,
    session: ClientSession,
    excludeTalentKpiRecordId?: string,
  ): Promise<void> {
    const existing =
      await this.repository.findNonArchivedByMeasurementIdentity(
        {
          ...candidate,
          excludeTalentKpiRecordId,
        },
        session,
      );

    if (!existing) {
      return;
    }

    throw new TalentKpiConflictError(
      "Measurement identity already exists for a non-archived KPI record",
    );
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly talentKpiRecordId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.talentKpiRecordId,
      {
        mutationType: params.mutationType,
        targetId: params.talentKpiRecordId,
        targetType: "talent-kpi-record",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    startMetadata: Readonly<Record<string, unknown>>,
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
    onSuccess: (
      result: T,
    ) => Readonly<Record<string, unknown>>,
  ): Promise<T> {
    this.logMutationEvent(
      actor,
      operation,
      "mutation.start",
      startMetadata,
    );

    try {
      const traceId = getTraceIdOrThrow();
      const result = await this.mutationBridge.execute(
        {
          actor,
          traceId,
          requiredPermission: permission,
          mutationIdentity: operation,
          mutationTargetDescriptor:
            buildMutationTargetDescriptor(
              startMetadata,
            ),
        },
        async (session, controls) =>
          fn(session, controls),
      );

      this.logMutationEvent(
        actor,
        operation,
        "mutation.success",
        {
          ...startMetadata,
          ...onSuccess(result),
        },
      );

      return result;
    } catch (error) {
      this.logger.warn({
        traceId: getTraceIdOrThrow(),
        actorId: actor.id,
        context: actor.context,
        operation,
        status: "mutation.failed",
        timestamp: Date.now(),
        metadata: {
          ...startMetadata,
          classification:
            classifyTalentKpiMutationFailure(error),
          errorCode: extractErrorCode(error),
          errorMessage:
            truncateLogMessage(error),
        },
      });

      throw error;
    }
  }

  private logMutationEvent(
    actor: Actor,
    operation: AuthoritativeAdminMutationIdentity,
    status: "mutation.start" | "mutation.success",
    metadata: Readonly<Record<string, unknown>>,
  ): void {
    this.logger.info({
      traceId: getTraceIdOrThrow(),
      actorId: actor.id,
      context: actor.context,
      operation,
      status,
      timestamp: Date.now(),
      metadata,
    });
  }
}

function normalizeCreateCommand(
  command: CreateTalentKpiRecordCommand,
): NormalizedCreateCommand {
  const kpiRecordCode = normalizeOptionalCreateCode(
    command.kpiRecordCode,
    "kpiRecordCode",
  );
  const title = normalizeRequiredText(
    command.title,
    "title",
  );

  return {
    kpiRecordCode,
    title,
    normalizedTitle: canonicalizeSearchToken(title),
    subjectTalentId: normalizeRequiredText(
      command.subjectTalentId,
      "subjectTalentId",
    ),
    attributionPlatformAccountId:
      normalizeOptionalNullableId(
        command.attributionPlatformAccountId,
        "attributionPlatformAccountId",
        {
          missingAsNull: true,
        },
      ) ?? null,
    attributionEventId: normalizeOptionalNullableId(
      command.attributionEventId,
      "attributionEventId",
      {
        missingAsNull: true,
      },
    ) ?? null,
    measurementSource:
      normalizeMeasurementSource(
        command.measurementSource,
      ),
    periodStartAt: normalizeTimestamp(
      command.periodStartAt,
      "periodStartAt",
    ),
    periodEndAt: normalizeTimestamp(
      command.periodEndAt,
      "periodEndAt",
    ),
    metrics: normalizeMetricSet(
      command.metrics,
      "metrics",
    ),
    description: normalizeOptionalNullableText(
      command.description,
      "description",
      {
        missingAsNull: true,
      },
    ) ?? null,
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
      {
        missingAsNull: true,
      },
    ) ?? null,
  };
}

function normalizeOptionalCreateCode(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function normalizeUpdateDraftCoreCommand(
  command: UpdateTalentKpiDraftCoreCommand,
): NormalizedUpdateDraftCoreCommand {
  const title = normalizeOptionalText(
    command.title,
    "title",
  );

  return {
    talentKpiRecordId: normalizeRequiredText(
      command.talentKpiRecordId,
      "talentKpiRecordId",
    ),
    title,
    normalizedTitle:
      title === undefined
        ? undefined
        : canonicalizeSearchToken(title),
    subjectTalentId: normalizeOptionalText(
      command.subjectTalentId,
      "subjectTalentId",
    ),
    attributionPlatformAccountId:
      normalizeOptionalNullableId(
        command.attributionPlatformAccountId,
        "attributionPlatformAccountId",
        {
          missingAsUndefined: true,
        },
      ),
    attributionEventId: normalizeOptionalNullableId(
      command.attributionEventId,
      "attributionEventId",
      {
        missingAsUndefined: true,
      },
    ),
    periodStartAt: normalizeOptionalTimestamp(
      command.periodStartAt,
      "periodStartAt",
    ),
    periodEndAt: normalizeOptionalTimestamp(
      command.periodEndAt,
      "periodEndAt",
    ),
    description: normalizeOptionalNullableText(
      command.description,
      "description",
      {
        missingAsUndefined: true,
      },
    ),
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
      {
        missingAsUndefined: true,
      },
    ),
  };
}

function normalizeReplaceMetricsCommand(
  command: ReplaceTalentKpiMetricsCommand,
): NormalizedReplaceMetricsCommand {
  return {
    talentKpiRecordId: normalizeRequiredText(
      command.talentKpiRecordId,
      "talentKpiRecordId",
    ),
    metrics: normalizeMetricSet(
      command.metrics,
      "metrics",
    ),
  };
}

function normalizeLifecycleCommand(
  command:
    | FinalizeTalentKpiRecordCommand
    | ArchiveTalentKpiRecordCommand,
): NormalizedLifecycleCommand {
  return {
    talentKpiRecordId: normalizeRequiredText(
      command.talentKpiRecordId,
      "talentKpiRecordId",
    ),
  };
}

function buildDraftCorePatch(
  current: TalentKpiRecord,
  input: NormalizedUpdateDraftCoreCommand,
): DraftCorePatchBuildResult {
  const update: DraftCorePatchBuildResult["update"] =
    {};
  const changedFields: string[] = [];

  if (
    input.title !== undefined &&
    input.title !== current.title
  ) {
    update.title = input.title;
    update.normalizedTitle = input.normalizedTitle;
    changedFields.push("title");
  }

  if (
    input.subjectTalentId !== undefined &&
    input.subjectTalentId !== current.subjectTalentId
  ) {
    update.subjectTalentId = input.subjectTalentId;
    changedFields.push("subjectTalentId");
  }

  if (
    input.attributionPlatformAccountId !== undefined &&
    input.attributionPlatformAccountId !==
      current.attributionPlatformAccountId
  ) {
    update.attributionPlatformAccountId =
      input.attributionPlatformAccountId;
    changedFields.push(
      "attributionPlatformAccountId",
    );
  }

  if (
    input.attributionEventId !== undefined &&
    input.attributionEventId !==
      current.attributionEventId
  ) {
    update.attributionEventId =
      input.attributionEventId;
    changedFields.push("attributionEventId");
  }

  if (
    input.periodStartAt !== undefined &&
    input.periodStartAt !== current.periodStartAt
  ) {
    update.periodStartAt = input.periodStartAt;
    changedFields.push("periodStartAt");
  }

  if (
    input.periodEndAt !== undefined &&
    input.periodEndAt !== current.periodEndAt
  ) {
    update.periodEndAt = input.periodEndAt;
    changedFields.push("periodEndAt");
  }

  if (
    input.description !== undefined &&
    input.description !== current.description
  ) {
    update.description = input.description;
    changedFields.push("description");
  }

  if (
    input.externalRef !== undefined &&
    input.externalRef !== current.externalRef
  ) {
    update.externalRef = input.externalRef;
    changedFields.push("externalRef");
  }

  const candidate: TalentKpiCandidateState = {
    subjectTalentId:
      input.subjectTalentId ??
      current.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId !==
      undefined
        ? input.attributionPlatformAccountId
        : current.attributionPlatformAccountId,
    attributionEventId:
      input.attributionEventId !== undefined
        ? input.attributionEventId
        : current.attributionEventId,
    measurementSource: current.measurementSource,
    periodStartAt:
      input.periodStartAt ?? current.periodStartAt,
    periodEndAt:
      input.periodEndAt ?? current.periodEndAt,
  };

  return {
    update,
    candidate,
    changedFields,
  };
}

function buildDraftCoreAuditDelta(
  before: TalentKpiRecord,
  after: TalentKpiRecord,
  changedFields: readonly string[],
): Readonly<Record<string, unknown>> {
  const changedSet = new Set(changedFields);
  const metadata: Record<string, unknown> = {};

  if (changedSet.has("subjectTalentId")) {
    metadata.subjectTalentIdBefore =
      before.subjectTalentId;
    metadata.subjectTalentIdAfter =
      after.subjectTalentId;
  }

  if (
    changedSet.has("attributionPlatformAccountId")
  ) {
    metadata.attributionPlatformAccountIdBefore =
      before.attributionPlatformAccountId;
    metadata.attributionPlatformAccountIdAfter =
      after.attributionPlatformAccountId;
  }

  if (changedSet.has("attributionEventId")) {
    metadata.attributionEventIdBefore =
      before.attributionEventId;
    metadata.attributionEventIdAfter =
      after.attributionEventId;
  }

  return Object.freeze(metadata);
}

function normalizeMetricSet(
  value: unknown,
  field: string,
): readonly NormalizedMetricValue[] {
  if (!Array.isArray(value)) {
    throw new TalentKpiValidationError(
      `${field} must be an array`,
    );
  }

  if (value.length === 0) {
    throw new TalentKpiValidationError(
      `${field} must contain at least one metric`,
    );
  }

  const normalizedMetrics = value.map(
    (item, index) =>
      normalizeMetricItem(
        item,
        `${field}[${index}]`,
      ),
  );
  const uniqueByCode =
    new Map<TalentKpiMetricCode, NormalizedMetricValue>();

  for (const metric of normalizedMetrics) {
    if (uniqueByCode.has(metric.metricCode)) {
      throw new TalentKpiValidationError(
        `${field} contains duplicate metricCode ${metric.metricCode}`,
      );
    }

    uniqueByCode.set(metric.metricCode, metric);
  }

  return [...uniqueByCode.values()].sort(
    compareMetricValues,
  );
}

function normalizeMetricItem(
  value: unknown,
  field: string,
): NormalizedMetricValue {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TalentKpiValidationError(
      `${field} must be a plain object`,
    );
  }

  const record = value as Record<string, unknown>;
  const metricCode = normalizeMetricCode(
    record.metricCode,
    `${field}.metricCode`,
  );
  const numericValue = normalizeMetricNumericValue(
    metricCode,
    record.numericValue,
    `${field}.numericValue`,
  );

  return {
    metricCode,
    numericValue,
    canonicalNumericValue:
      metricNumericValueToCanonicalString(
        metricCode,
        numericValue,
      ),
  };
}

function normalizeStoredMetricSet(
  metrics: readonly TalentKpiMetricValue[],
): readonly NormalizedMetricValue[] {
  const normalizedMetrics = metrics.map((metric) => {
    const numericValue = normalizeMetricNumericValue(
      metric.metricCode,
      metric.numericValue,
      `metric(${metric.metricCode})`,
    );

    return {
      metricCode: metric.metricCode,
      numericValue,
      canonicalNumericValue:
        metricNumericValueToCanonicalString(
          metric.metricCode,
          numericValue,
        ),
    } satisfies NormalizedMetricValue;
  });

  const uniqueByCode =
    new Map<TalentKpiMetricCode, NormalizedMetricValue>();

  for (const metric of normalizedMetrics) {
    if (uniqueByCode.has(metric.metricCode)) {
      throw new TalentKpiStateError(
        `Stored metric set contains duplicate metricCode ${metric.metricCode}`,
      );
    }

    uniqueByCode.set(metric.metricCode, metric);
  }

  return [...uniqueByCode.values()].sort(
    compareMetricValues,
  );
}

function compareMetricValues(
  left: Pick<
    NormalizedMetricValue,
    "metricCode"
  >,
  right: Pick<
    NormalizedMetricValue,
    "metricCode"
  >,
): number {
  if (left.metricCode < right.metricCode) {
    return -1;
  }

  if (left.metricCode > right.metricCode) {
    return 1;
  }

  return 0;
}

function areCanonicalMetricSetsEqual(
  left: readonly NormalizedMetricValue[],
  right: readonly NormalizedMetricValue[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    const leftMetric = left[i];
    const rightMetric = right[i];

    if (!leftMetric || !rightMetric) {
      return false;
    }

    if (
      leftMetric.metricCode !==
        rightMetric.metricCode ||
      leftMetric.canonicalNumericValue !==
        rightMetric.canonicalNumericValue
    ) {
      return false;
    }
  }

  return true;
}

function toMetricValueRecords(
  talentKpiRecordId: string,
  metrics: readonly NormalizedMetricValue[],
  now: number,
): readonly TalentKpiMetricValue[] {
  return metrics.map((metric) => ({
    id: crypto.randomUUID(),
    kpiRecordId: talentKpiRecordId,
    metricCode: metric.metricCode,
    numericValue: metric.numericValue,
    createdAt: now,
    updatedAt: now,
  }));
}

function toMetricAuditView(
  metrics: readonly Pick<
    NormalizedMetricValue,
    "metricCode" | "numericValue"
  >[],
): readonly {
  readonly metricCode: TalentKpiMetricCode;
  readonly numericValue: number;
}[] {
  return metrics.map((metric) => ({
    metricCode: metric.metricCode,
    numericValue: metric.numericValue,
  }));
}

function toTalentKpiRecordMutationView(
  record: TalentKpiRecord,
): TalentKpiRecordMutationView {
  return {
    id: record.id,
    kpiRecordCode: record.kpiRecordCode,
    title: record.title,
    subjectTalentId: record.subjectTalentId,
    attributionPlatformAccountId:
      record.attributionPlatformAccountId,
    attributionEventId: record.attributionEventId,
    measurementSource: record.measurementSource,
    status: record.status,
    periodStartAt: record.periodStartAt,
    periodEndAt: record.periodEndAt,
    publishedAt: record.publishedAt,
    description: record.description,
    externalRef: record.externalRef,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentKpiValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeOptionalText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeRequiredText(value, field);
}

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull?: boolean;
    readonly missingAsUndefined?: boolean;
  },
): string | null | undefined {
  if (value === undefined) {
    if (options.missingAsUndefined) {
      return undefined;
    }

    if (options.missingAsNull) {
      return null;
    }
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `${field} must be a string or null`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentKpiValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull?: boolean;
    readonly missingAsUndefined?: boolean;
  },
): string | null | undefined {
  if (value === undefined) {
    if (options.missingAsUndefined) {
      return undefined;
    }

    if (options.missingAsNull) {
      return null;
    }
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `${field} must be a string or null`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentKpiValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeTimestamp(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw new TalentKpiValidationError(
      `${field} must be an integer UTC timestamp`,
    );
  }

  return value;
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeTimestamp(value, field);
}

function normalizeMeasurementSource(
  value: unknown,
): TalentKpiMeasurementSource {
  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `measurementSource must be one of ${TALENT_KPI_MEASUREMENT_SOURCES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_KPI_MEASUREMENT_SOURCES.includes(
      normalized as TalentKpiMeasurementSource,
    )
  ) {
    return normalized as TalentKpiMeasurementSource;
  }

  throw new TalentKpiValidationError(
    `measurementSource must be one of ${TALENT_KPI_MEASUREMENT_SOURCES.join(", ")}`,
  );
}

function normalizeMetricCode(
  value: unknown,
  field: string,
): TalentKpiMetricCode {
  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `${field} must be one of ${TALENT_KPI_METRIC_CODES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_KPI_METRIC_CODES.includes(
      normalized as TalentKpiMetricCode,
    )
  ) {
    return normalized as TalentKpiMetricCode;
  }

  throw new TalentKpiValidationError(
    `${field} must be one of ${TALENT_KPI_METRIC_CODES.join(", ")}`,
  );
}

function normalizeMetricNumericValue(
  metricCode: TalentKpiMetricCode,
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new TalentKpiInvalidMetricValueError(
      `${field} must be a finite number for metricCode ${metricCode}`,
    );
  }

  if (
    METRIC_CODES_REQUIRING_NON_NEGATIVE_DECIMAL.has(
      metricCode,
    )
  ) {
    if (value < 0) {
      throw new TalentKpiInvalidMetricValueError(
        `${field} must be non-negative for metricCode ${metricCode}`,
      );
    }

    const rounded =
      Math.round(value * 100) / 100;

    if (Math.abs(value - rounded) > 1e-9) {
      throw new TalentKpiInvalidMetricValueError(
        `${field} must have at most 2 decimal places for metricCode ${metricCode}`,
      );
    }

    return sanitizeNegativeZero(rounded);
  }

  if (
    METRIC_CODES_REQUIRING_NON_NEGATIVE_INTEGER.has(
      metricCode,
    )
  ) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TalentKpiInvalidMetricValueError(
        `${field} must be a non-negative integer for metricCode ${metricCode}`,
      );
    }

    return sanitizeNegativeZero(value);
  }

  if (metricCode === "FOLLOWER_DELTA") {
    if (!Number.isInteger(value)) {
      throw new TalentKpiInvalidMetricValueError(
        `${field} must be an integer for metricCode ${metricCode}`,
      );
    }

    return sanitizeNegativeZero(value);
  }

  throw new TalentKpiValidationError(
    `Unsupported metricCode ${metricCode}`,
  );
}

function metricNumericValueToCanonicalString(
  metricCode: TalentKpiMetricCode,
  numericValue: number,
): string {
  if (
    METRIC_CODES_REQUIRING_NON_NEGATIVE_DECIMAL.has(
      metricCode,
    )
  ) {
    return numericValue.toFixed(2);
  }

  return String(numericValue);
}

function sanitizeNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function resolveRequiredGlobalScope(
  actor: Actor,
): "global" {
  if (
    PermissionGuard.hasTalentKpiScopeGrant(
      actor,
      "global",
    )
  ) {
    return "global";
  }

  throw new TalentKpiPermissionScopeError(
    "Talent KPI mutation requires global scope",
  );
}

function assertMeasurementSourceRule(
  measurementSource: TalentKpiMeasurementSource,
): void {
  if (measurementSource === "MANUAL") {
    return;
  }

  throw new TalentKpiValidationError(
    "measurementSource must be MANUAL",
  );
}

function assertMeasurementPeriodRule(
  periodStartAt: number,
  periodEndAt: number,
  evaluationTime: number,
): void {
  if (periodEndAt <= periodStartAt) {
    throw new TalentKpiValidationError(
      "periodEndAt must be strictly greater than periodStartAt",
    );
  }

  if (periodEndAt > evaluationTime) {
    throw new TalentKpiValidationError(
      "periodEndAt must not be later than evaluation time",
    );
  }
}

function canonicalizeSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function assertAdminActorType(
  actor: Actor,
): void {
  PermissionGuard.assertAdminActor(actor);
}

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);

  if (
    typeof encoded === "string" &&
    encoded.length > 2
  ) {
    return encoded;
  }

  return "target:unspecified";
}

function classifyTalentKpiMutationFailure(
  error: unknown,
): TalentKpiMutationFailureClassification {
  if (error instanceof TalentKpiValidationError) {
    return "validation";
  }

  if (error instanceof TalentKpiConflictError) {
    return "conflict";
  }

  if (error instanceof TalentKpiNotFoundError) {
    return "not_found";
  }

  if (error instanceof TalentKpiStateError) {
    return "state_error";
  }

  if (
    error instanceof
    TalentKpiInvalidTalentReferenceError
  ) {
    return "invalid_talent_reference";
  }

  if (
    error instanceof
    TalentKpiInvalidPlatformAttributionError
  ) {
    return "invalid_platform_attribution";
  }

  if (
    error instanceof
    TalentKpiInvalidEventAttributionError
  ) {
    return "invalid_event_attribution";
  }

  if (
    error instanceof TalentKpiInvalidMetricValueError
  ) {
    return "invalid_metric_value";
  }

  if (
    error instanceof TalentKpiPermissionScopeError
  ) {
    return "permission_scope";
  }

  if (error instanceof SystemInvariantError) {
    return "invariant";
  }

  return "unknown";
}

function extractErrorCode(
  error: unknown,
): string | undefined {
  if (error instanceof BaseAppError) {
    return error.code;
  }

  if (error instanceof SystemInvariantError) {
    return error.code;
  }

  return undefined;
}

function truncateLogMessage(
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  if (raw.length <= 256) {
    return raw;
  }

  return `${raw.slice(0, 253)}...`;
}

function readOptionalLogString(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}
