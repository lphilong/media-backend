import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientSession, Db } from "mongodb";
import type { Request } from "express";
import { bindCommand } from "@app/base/command.middleware";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import type {
  BusinessCodePolicy,
  BusinessCodeSequenceRepository,
} from "@core/business-code/business-code-sequence.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import type { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import type { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import { EmploymentTermsAdminService } from "./admin/admin.employment-terms.service";
import { EmploymentTermsAdminController } from "./admin/admin.employment-terms.controller";
import {
  adminEmploymentTermsAllProfilesRoutes,
  adminEmploymentTermsRoutes,
} from "./admin/admin.employment-terms.routes";
import {
  EmploymentTermsConflictError,
  EmploymentTermsStateError,
  EmploymentTermsValidationError,
} from "./domain/employment-terms.errors";
import type {
  EmploymentTermsRepository,
  ListEmploymentTermsAdminRecordsInput,
  TransitionEmploymentTermsInput,
  UpdateEmploymentTermsDraftInput,
} from "./domain/employment-terms.repository";
import type {
  EmploymentTermsAdminListRecord,
  EmploymentTermsAllowance,
  EmploymentTermsOverlapContextRecord,
  EmploymentTermsRecord,
} from "./domain/employment-terms.types";
import { NativeMongoEmploymentTermsRepository } from "@infra/mongo/employment-terms/employment-terms.repository";

const audit = { async record() {} } as unknown as AuditGuard;

test("Employment Terms lifecycle enforces maker/checker, redaction, and payroll-readable selection", async () => {
  const { service, terms } = fixture();
  const maker = actor("maker", [
    Permission.EMPLOYMENT_TERMS_READ,
    Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT,
  ]);
  const checker = actor("checker", [
    Permission.EMPLOYMENT_TERMS_READ,
    Permission.EMPLOYMENT_TERMS_READ_SENSITIVE,
    Permission.EMPLOYMENT_TERMS_APPROVE,
  ]);

  await bindTraceId("hret-lifecycle", async () => {
    const created = await service.create(maker, validCreate());
    assert.equal(created.status, "DRAFT");
    assert.equal(created.sensitiveAmountsRedacted, true);
    assert.equal(created.baseSalaryAmount, undefined);
    assert.equal(created.allowances[0]?.amount, undefined);

    const updated = await service.update(maker, {
      ...validCreate(),
      termsId: created.id,
      baseSalaryAmount: 11_000_000,
    });
    assert.equal(updated.version, 2);

    const submitted = await service.submit(maker, {
      employmentProfileId: "ep-1",
      termsId: created.id,
    });
    assert.equal(submitted.status, "PENDING_APPROVAL");

    await assert.rejects(
      service.approve(
        actor("maker", [Permission.EMPLOYMENT_TERMS_APPROVE]),
        { employmentProfileId: "ep-1", termsId: created.id },
      ),
      EmploymentTermsConflictError,
    );

    const approved = await service.approve(checker, {
      employmentProfileId: "ep-1",
      termsId: created.id,
    });
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.baseSalaryAmount, 11_000_000);

    await assert.rejects(
      service.update(maker, {
        employmentProfileId: "ep-1",
        termsId: created.id,
        baseSalaryAmount: 1,
      }),
      EmploymentTermsStateError,
    );

    const cancellable = await service.create(maker, {
      ...validCreate(),
      effectiveFrom: "2027-01-01",
      effectiveTo: null,
    });
    const cancelled = await service.cancel(maker, {
      employmentProfileId: "ep-1",
      termsId: cancellable.id,
    });
    assert.equal(cancelled.status, "CANCELLED");
    await assert.rejects(
      service.update(maker, {
        employmentProfileId: "ep-1",
        termsId: cancellable.id,
        baseSalaryAmount: 1,
      }),
      EmploymentTermsStateError,
    );

    const payroll = await service.getPayrollReadableForDate("ep-1", "2026-02-01");
    assert.equal(payroll?.baseSalaryAmount, 11_000_000);
    assert.equal(payroll?.allowances.length, 1);
    assert.equal(terms.records[0]?.approvedBy, "checker");
  });
});

test("Employment Terms validates profile, money, currency, dates, pay frequency, and overlap", async () => {
  const { service } = fixture();
  const maker = actor("maker", [
    Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT,
    Permission.EMPLOYMENT_TERMS_READ_SENSITIVE,
  ]);
  const checker = actor("checker", [Permission.EMPLOYMENT_TERMS_APPROVE]);

  await bindTraceId("hret-validation", async () => {
    for (const command of [
      { ...validCreate(), employmentProfileId: "missing" },
      { ...validCreate(), employmentProfileId: "ep-archived" },
      { ...validCreate(), baseSalaryAmount: -1 },
      { ...validCreate(), currencyCode: undefined },
      { ...validCreate(), currencyCode: "vnd" },
      { ...validCreate(), payFrequency: undefined },
      { ...validCreate(), payFrequency: "WEEKLY" },
      { ...validCreate(), effectiveTo: "2025-12-31" },
      { ...validCreate(), allowances: [{ ...validCreate().allowances![0]!, amount: -1 }] },
    ]) {
      await assert.rejects(service.create(maker, command as never), EmploymentTermsValidationError);
    }

    const first = await service.create(maker, validCreate());
    await service.submit(maker, { employmentProfileId: "ep-1", termsId: first.id });
    await service.approve(checker, { employmentProfileId: "ep-1", termsId: first.id });

    const overlapping = await service.create(maker, { ...validCreate(), effectiveFrom: "2026-06-01" });
    await service.submit(maker, { employmentProfileId: "ep-1", termsId: overlapping.id });
    await assert.rejects(
      service.approve(checker, { employmentProfileId: "ep-1", termsId: overlapping.id }),
      EmploymentTermsConflictError,
    );
  });
});

test("Employment Terms bounds source notes, allowance text, and allowance count", async () => {
  const { service } = fixture();
  const maker = actor("maker", [Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT]);
  const validAllowance = validCreate().allowances[0]!;

  await bindTraceId("hret-bounded-validation", async () => {
    for (const command of [
      { ...validCreate(), sourceNote: "x".repeat(501) },
      { ...validCreate(), allowances: [{ ...validAllowance, sourceNote: "x".repeat(501) }] },
      { ...validCreate(), allowances: [{ ...validAllowance, type: "x".repeat(65) }] },
      { ...validCreate(), allowances: [{ ...validAllowance, label: "x".repeat(121) }] },
      { ...validCreate(), allowances: Array.from({ length: 21 }, () => validAllowance) },
    ]) {
      await assert.rejects(service.create(maker, command), EmploymentTermsValidationError);
    }

    const boundary = await service.create(maker, {
      ...validCreate(),
      sourceNote: "x".repeat(500),
      allowances: Array.from({ length: 20 }, (_, index) => ({
        ...validAllowance,
        type: `${index}`.padEnd(64, "x"),
        label: `${index}`.padEnd(120, "x"),
        sourceNote: "x".repeat(500),
      })),
    });
    assert.equal(boundary.allowances.length, 20);
    assert.equal(boundary.sourceNote?.length, 500);
  });
});

test("Employment Terms selector fails closed for invalid payroll-eligible allowances", async () => {
  const validAllowance = allowance();
  for (const invalidAllowance of [
    { ...validAllowance, amount: Number.NaN },
    { ...validAllowance, amount: -1 },
    { ...validAllowance, currencyCode: undefined as never },
    { ...validAllowance, currencyCode: "vnd" },
    { ...validAllowance, effectiveFrom: Date.UTC(2026, 2, 1), effectiveTo: Date.UTC(2026, 1, 1) },
    { ...validAllowance, type: "x".repeat(65) },
    { ...validAllowance, label: "x".repeat(121) },
    { ...validAllowance, sourceNote: "x".repeat(501) },
    null as never,
  ]) {
    const { service, terms } = fixture();
    terms.records.push(record({ approvedAt: 1, allowances: [invalidAllowance] }));
    await assert.rejects(
      service.getPayrollReadableForDate("ep-1", "2026-02-01"),
      EmploymentTermsConflictError,
    );
  }

  const { service, terms } = fixture();
  terms.records.push(record({
    approvedAt: 1,
    allowances: [
      validAllowance,
      { ...validAllowance, type: "FUTURE", effectiveFrom: Date.UTC(2026, 2, 1) },
      { ...validAllowance, type: "NON_PAYROLL", payrollEligible: false },
    ],
  }));
  const selected = await service.getPayrollReadableForDate("ep-1", "2026-02-01");
  assert.deepEqual(selected?.allowances, [validAllowance]);
});

test("Employment Terms serializes concurrent overlapping approvals per profile", async () => {
  const { service, terms } = fixture();
  const maker = actor("maker", [Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT]);
  const checker = actor("checker", [Permission.EMPLOYMENT_TERMS_APPROVE]);

  await bindTraceId("hret-concurrent-approval", async () => {
    const first = await service.create(maker, validCreate());
    const second = await service.create(maker, { ...validCreate(), effectiveFrom: "2026-06-01" });
    await service.submit(maker, { employmentProfileId: "ep-1", termsId: first.id });
    await service.submit(maker, { employmentProfileId: "ep-1", termsId: second.id });

    const results = await Promise.allSettled([
      service.approve(checker, { employmentProfileId: "ep-1", termsId: first.id }),
      service.approve(checker, { employmentProfileId: "ep-1", termsId: second.id }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(rejected);
    assert.ok(rejected.reason instanceof EmploymentTermsConflictError);
    assert.equal(
      terms.records.filter((item) => item.status === "APPROVED" && item.payrollEligible).length,
      1,
    );
  });
});

test("Employment Terms permissions are Admin-only and employmentProfile.read does not expose salary", async () => {
  const { service } = fixture();
  await bindTraceId("hret-permissions", async () => {
    await assert.rejects(service.create(actor("admin", []), validCreate()), permissionDenied);
    await assert.rejects(
      service.create(
        new Actor({
          id: "staff",
          type: "staff",
          context: "ADMIN",
          roles: ["TEAM_MANAGER"],
          permissions: [Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT],
          isActive: true,
        }),
        validCreate(),
      ),
      permissionDenied,
    );

    const record = await service.create(
      actor("maker", [Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT]),
      validCreate(),
    );
    await assert.rejects(
      service.get(actor("reader", [Permission.EMPLOYMENT_PROFILE_READ]), {
        employmentProfileId: "ep-1",
        termsId: record.id,
      }),
      permissionDenied,
    );
    const redacted = await service.get(actor("reader", [Permission.EMPLOYMENT_TERMS_READ]), {
      employmentProfileId: "ep-1",
      termsId: record.id,
    });
    assert.equal(redacted.baseSalaryAmount, undefined);
    assert.equal("createdBy" in redacted, false);
    assert.equal("approvedBy" in redacted, false);
    assert.equal("linkedUserId" in redacted, false);
  });
});

test("Employment Terms admin all-profiles list enforces dedicated read permission and redacts amounts", async () => {
  const { service } = adminListFixture();
  await bindTraceId("hret-admin-list-access", async () => {
    await assert.rejects(
      () => service.listAllProfiles(undefined as never, {}),
      (error: unknown) => {
        assert.ok(error instanceof SystemInvariantError);
        assert.equal(error.code, "ACTOR_MISSING");
        return true;
      },
    );
    await assert.rejects(
      () => service.listAllProfiles(
        new Actor({
          id: "staff",
          type: "staff",
          context: "ADMIN",
          roles: [],
          permissions: [Permission.EMPLOYMENT_TERMS_READ],
          scopeGrants: {},
          isActive: true,
        }),
        {},
      ),
      permissionDenied,
    );
    await assert.rejects(
      () => service.listAllProfiles(actor("profile-reader", [Permission.EMPLOYMENT_PROFILE_READ]), {}),
      permissionDenied,
    );

    const redacted = await service.listAllProfiles(actor("reader", [Permission.EMPLOYMENT_TERMS_READ]), {
      employmentProfileId: "ep-a",
      limit: "1",
    });
    assert.equal(redacted.items.length, 1);
    assert.equal(redacted.items[0]?.sensitiveAmountsRedacted, true);
    assert.equal(redacted.items[0]?.baseSalaryAmount, undefined);
    assert.equal(redacted.items[0]?.allowances[0]?.amount, undefined);
    assert.notEqual(redacted.items[0]?.baseSalaryAmount, 0);
    const serialized = JSON.stringify(redacted);
    [
      "createdBy",
      "updatedBy",
      "submittedBy",
      "approvedBy",
      "cancelledBy",
      "contractRegistry",
      "document",
      "bank",
      "tax",
      "payrollRun",
    ].forEach((field) => assert.equal(serialized.includes(field), false, field));

    const sensitive = await service.listAllProfiles(
      actor("finance", [
        Permission.EMPLOYMENT_TERMS_READ,
        Permission.EMPLOYMENT_TERMS_READ_SENSITIVE,
      ]),
      {
        employmentProfileId: "ep-a",
        effectiveOn: "2026-02-01",
        readiness: "CURRENT_EFFECTIVE",
        limit: "1",
      },
    );
    assert.equal(sensitive.items[0]?.baseSalaryAmount, 0);
    assert.equal(sensitive.items[0]?.allowances[0]?.amount, 100);
    assert.equal(sensitive.items[0]?.sensitiveAmountsRedacted, false);
  });
});

test("Employment Terms admin all-profiles list supports safe filters and search", async () => {
  const { service } = adminListFixture();
  const reader = actor("reader", [Permission.EMPLOYMENT_TERMS_READ]);

  await bindTraceId("hret-admin-list-filters", async () => {
    assert.deepEqual(
      (await service.listAllProfiles(reader, { employmentProfileId: "ep-b" })).items.map((item) => item.employmentProfile.id),
      ["ep-b", "ep-b", "ep-b"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, { orgUnitId: "org-a" })).items.map((item) => item.employmentProfile.id),
      ["ep-a", "ep-a", "ep-a", "ep-a"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, { employmentStatus: "ON_LEAVE" })).items.map((item) => item.employmentProfile.id),
      ["ep-b", "ep-b", "ep-b"],
    );
    assert.equal((await service.listAllProfiles(reader, { status: "PENDING_APPROVAL" })).items.length, 2);
    assert.equal((await service.listAllProfiles(reader, { payrollEligible: "false" })).items.length, 2);
    assert.deepEqual(
      (await service.listAllProfiles(reader, { effectiveOn: "2026-06-01" })).items.map((item) => item.id),
      ["pending-ineligible", "pending-a", "overlap-a", "current-a", "ineligible-b", "missing-b"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, { expiringBefore: "2025-12-31" })).items.map((item) => item.id),
      ["expired-b"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, { search: "alice" })).items.map((item) => item.employmentProfile.id),
      ["ep-a", "ep-a", "ep-a", "ep-a"],
    );
  });
});

test("Employment Terms admin all-profiles readiness filters preserve accepted evaluator semantics", async () => {
  const { service } = adminListFixture();
  const reader = actor("reader", [Permission.EMPLOYMENT_TERMS_READ]);
  const query = (readiness: string) =>
    service.listAllProfiles(reader, { readiness, limit: "100" });

  await bindTraceId("hret-admin-list-readiness", async () => {
    assert.deepEqual(
      (await query("CURRENT_EFFECTIVE")).items.map((item) => item.id),
      ["overlap-a", "current-a"],
    );
    assert.deepEqual(
      (await query("PENDING_APPROVAL")).items.map((item) => item.id),
      ["pending-a"],
    );
    assert.deepEqual(
      (await query("EXPIRED")).items.map((item) => item.id),
      ["expired-b"],
    );
    assert.deepEqual(
      (await query("MISSING_BASE_SALARY")).items.map((item) => item.id),
      ["missing-b"],
    );
    assert.deepEqual(
      (await query("OVERLAPPING")).items.map((item) => item.id),
      ["overlap-a", "current-a"],
    );
    assert.equal(
      (await query("PAYROLL_SOURCE_ELIGIBLE")).items.every((item) => item.payrollEligible),
      true,
    );
    assert.deepEqual(
      (await query("PAYROLL_SOURCE_INELIGIBLE")).items.map((item) => item.id),
      ["pending-ineligible", "ineligible-b"],
    );
    assert.equal(
      (await service.listAllProfiles(reader, { readiness: "MISSING_BASE_SALARY", employmentProfileId: "ep-a" })).items.length,
      0,
    );
  });
});

test("Employment Terms OVERLAPPING readiness derives from full profile context under combined filters", async () => {
  const { service } = adminListFixture();
  const reader = actor("reader", [Permission.EMPLOYMENT_TERMS_READ]);

  await bindTraceId("hret-admin-list-overlap-combined", async () => {
    assert.deepEqual(
      (await service.listAllProfiles(reader, { readiness: "OVERLAPPING" })).items.map((item) => item.id),
      ["overlap-a", "current-a"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, {
        readiness: "OVERLAPPING",
        effectiveOn: "2026-02-01",
      })).items.map((item) => item.id),
      ["current-a"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, {
        readiness: "OVERLAPPING",
        expiringBefore: "2026-06-30",
      })).items.map((item) => item.id),
      ["overlap-a"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, {
        readiness: "OVERLAPPING",
        employmentProfileId: "ep-a",
      })).items.map((item) => item.id),
      ["overlap-a", "current-a"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, {
        readiness: "OVERLAPPING",
        orgUnitId: "org-a",
      })).items.map((item) => item.id),
      ["overlap-a", "current-a"],
    );
    assert.deepEqual(
      (await service.listAllProfiles(reader, {
        readiness: "OVERLAPPING",
        status: "APPROVED",
      })).items.map((item) => item.id),
      ["overlap-a", "current-a"],
    );
    assert.equal(
      (await service.listAllProfiles(reader, {
        readiness: "OVERLAPPING",
        employmentProfileId: "ep-b",
      })).items.length,
      0,
    );
  });
});

test("Employment Terms Mongo admin aggregation projects joined summaries and overlap context", async () => {
  let aggregationPipeline: readonly Record<string, unknown>[] = [];
  let contextFindOptions: Record<string, unknown> | undefined;
  const employmentTermsCollection = {
    aggregate(pipeline: readonly Record<string, unknown>[]) {
      aggregationPipeline = pipeline;
      return { async toArray() { return []; } };
    },
    find(_filter: Record<string, unknown>, options?: Record<string, unknown>) {
      contextFindOptions = options;
      return { async toArray() { return []; } };
    },
  };
  const db = {
    collection(name: string) {
      return name === "employment_terms" ? employmentTermsCollection : {};
    },
  } as unknown as Db;
  const repository = new NativeMongoEmploymentTermsRepository(db);

  await repository.listAdminRecords({ readiness: "OVERLAPPING" });
  await repository.listOverlapContextByEmploymentProfileIds(["ep-a"]);

  const lookupProjects = aggregationPipeline
    .filter((stage) => "$lookup" in stage)
    .map((stage) => stage.$lookup as {
      from: string;
      pipeline?: readonly Record<string, unknown>[];
    })
    .filter((lookup) => ["employment_profiles", "org_units", "users"].includes(lookup.from))
    .map((lookup) => ({
      from: lookup.from,
      project: lookup.pipeline?.find((stage) => "$project" in stage)?.$project,
    }));
  assert.deepEqual(lookupProjects, [
    {
      from: "employment_profiles",
      project: {
        _id: 1,
        employeeCode: 1,
        legalName: 1,
        normalizedLegalName: 1,
        displayName: 1,
        normalizedDisplayName: 1,
        orgUnitId: 1,
        linkedUserId: 1,
        employmentStatus: 1,
      },
    },
    {
      from: "org_units",
      project: { _id: 1, code: 1, name: 1, status: 1 },
    },
    {
      from: "users",
      project: {
        _id: 1,
        "profile.displayName": 1,
        "profile.email": 1,
        accountStatus: 1,
      },
    },
  ]);
  assert.deepEqual(contextFindOptions?.projection, {
    _id: 1,
    employmentProfileId: 1,
    status: 1,
    payrollEligible: 1,
    effectiveFrom: 1,
    effectiveTo: 1,
  });
});

test("Employment Terms admin all-profiles list rejects invalid params and paginates deterministically", async () => {
  const { service } = adminListFixture();
  const reader = actor("reader", [Permission.EMPLOYMENT_TERMS_READ]);

  await bindTraceId("hret-admin-list-pagination", async () => {
    for (const query of [
      { employmentStatus: "ACTIVE-ish" },
      { status: "ACTIVE" },
      { payrollEligible: "yes" },
      { effectiveOn: "01-06-2026" },
      { expiringBefore: "2026-02-30" },
      { readiness: "READY" },
      { limit: "0" },
      { limit: "101" },
      { cursor: "not-a-cursor" },
    ]) {
      await assert.rejects(
        () => service.listAllProfiles(reader, query),
        EmploymentTermsValidationError,
        JSON.stringify(query),
      );
    }

    const first = await service.listAllProfiles(reader, { limit: "2" });
    assert.deepEqual(first.items.map((item) => item.id), ["pending-ineligible", "pending-a"]);
    assert.ok(first.nextCursor);
    const second = await service.listAllProfiles(reader, {
      limit: "2",
      cursor: first.nextCursor ?? undefined,
    });
    assert.deepEqual(second.items.map((item) => item.id), ["overlap-a", "current-a"]);
    await assert.rejects(
      () => service.listAllProfiles(reader, {
        limit: "2",
        cursor: first.nextCursor ?? undefined,
        employmentProfileId: "ep-a",
      }),
      EmploymentTermsValidationError,
    );
  });
});

test("Employment Terms selector excludes draft, pending, cancelled, future, expired, and non-payroll-eligible records", async () => {
  const { service, terms } = fixture();
  const base = record({ status: "APPROVED", approvedAt: 1 });
  terms.records.push(
    record({ id: "draft", status: "DRAFT" }),
    record({ id: "pending", status: "PENDING_APPROVAL" }),
    record({ id: "cancelled", status: "CANCELLED" }),
    record({ id: "future", effectiveFrom: Date.UTC(2027, 0, 1), approvedAt: 1 }),
    record({ id: "expired", effectiveTo: Date.UTC(2025, 11, 31), approvedAt: 1 }),
    record({ id: "ineligible", payrollEligible: false, approvedAt: 1 }),
    base,
  );
  const selected = await service.getPayrollReadableForDate("ep-1", "2026-02-01");
  assert.equal(selected?.id, base.id);
  assert.equal(await service.getPayrollReadableForDate("ep-1", "2028-02-01"), null);
});

test("Employment Terms controller presents list arrays and keeps nested route identity authoritative", async () => {
  const service = {
    async list(_actor: Actor, employmentProfileId: string) {
      assert.equal(employmentProfileId, "ep-1");
      return [{ id: "terms-1", sensitiveAmountsRedacted: true }];
    },
  } as unknown as EmploymentTermsAdminService;
  const controller = new TestableEmploymentTermsController(service);
  const req = {
    params: { employmentProfileId: "ep-1" },
    query: {},
  } as unknown as Request;
  bindCommand(req, "EMPLOYMENT_TERMS_LIST");
  const result = await controller.dispatch(req, actor("reader", [Permission.EMPLOYMENT_TERMS_READ]));
  assert.deepEqual(result, { data: [{ id: "terms-1", sensitiveAmountsRedacted: true }] });
});

test("Employment Terms controller presents all-profiles list envelope and routes are distinct", async () => {
  const service = {
    async listAllProfiles(_actor: Actor, query: Record<string, unknown>) {
      assert.equal(query.limit, "1");
      return {
        items: [{ id: "terms-1", employmentProfileId: "ep-1", sensitiveAmountsRedacted: true }],
        nextCursor: null,
        appliedFilters: { effectiveOn: Date.UTC(2026, 0, 1) },
      };
    },
  } as unknown as EmploymentTermsAdminService;
  const controller = new TestableEmploymentTermsController(service);
  const req = {
    params: {},
    query: { limit: "1" },
  } as unknown as Request;
  bindCommand(req, "EMPLOYMENT_TERMS_ADMIN_LIST");
  const result = await controller.dispatch(req, actor("reader", [Permission.EMPLOYMENT_TERMS_READ]));
  assert.deepEqual(result, {
    data: {
      items: [{ id: "terms-1", employmentProfileId: "ep-1", sensitiveAmountsRedacted: true }],
      nextCursor: null,
      appliedFilters: { effectiveOn: Date.UTC(2026, 0, 1) },
    },
  });

  const topLevelRouter = adminEmploymentTermsAllProfilesRoutes(controller);
  const nestedRouter = adminEmploymentTermsRoutes(controller);
  assert.deepEqual(
    (topLevelRouter as unknown as { stack: Array<{ route?: { path?: string } }> })
      .stack.map((layer) => layer.route?.path).filter(Boolean),
    ["/"],
  );
  assert.deepEqual(
    (nestedRouter as unknown as { stack: Array<{ route?: { path?: string } }> })
      .stack.map((layer) => layer.route?.path).filter(Boolean),
    ["/", "/:termsId", "/", "/:termsId", "/:termsId/submit", "/:termsId/approve", "/:termsId/cancel"],
  );
});

function fixture() {
  const profiles = new Map<string, EmploymentProfileRecord>([
    ["ep-1", profile("ep-1", "ACTIVE")],
    ["ep-archived", profile("ep-archived", "ARCHIVED")],
  ]);
  const terms = new MemoryTermsRepository(profiles);
  const profileRepository = {
    async findById(id: string) {
      return profiles.get(id) ?? null;
    },
  } as EmploymentProfileRepository;
  const service = new EmploymentTermsAdminService(
    terms,
    new MemorySequence(),
    profileRepository,
    audit,
    new MemoryMutationBridge(terms),
    () => Date.UTC(2026, 0, 1),
  );
  return { service, terms };
}

function adminListFixture() {
  const profiles = new Map<string, EmploymentProfileRecord>([
    [
      "ep-a",
      profile("ep-a", "ACTIVE", {
        employeeCode: "EP-A",
        legalName: "Alice Legal",
        normalizedLegalName: "alice legal",
        displayName: "Alice",
        normalizedDisplayName: "alice",
        orgUnitId: "org-a",
      }),
    ],
    [
      "ep-b",
      profile("ep-b", "ON_LEAVE", {
        employeeCode: "EP-B",
        legalName: "Bob Legal",
        normalizedLegalName: "bob legal",
        displayName: "Bob",
        normalizedDisplayName: "bob",
        orgUnitId: "org-b",
      }),
    ],
    [
      "ep-archived",
      profile("ep-archived", "ARCHIVED", {
        displayName: "Archived",
        normalizedDisplayName: "archived",
      }),
    ],
  ]);
  const terms = new MemoryTermsRepository(profiles);
  terms.records.push(
    record({
      id: "current-a",
      employmentProfileId: "ep-a",
      effectiveFrom: Date.UTC(2026, 0, 1),
      effectiveTo: Date.UTC(2026, 11, 31),
      baseSalaryAmount: 0,
      approvedAt: Date.UTC(2026, 0, 2),
      updatedAt: 17,
      allowances: [allowance({ amount: 100 })],
    }),
    record({
      id: "overlap-a",
      employmentProfileId: "ep-a",
      effectiveFrom: Date.UTC(2026, 5, 1),
      effectiveTo: Date.UTC(2026, 5, 30),
      baseSalaryAmount: 1,
      approvedAt: Date.UTC(2026, 5, 2),
      updatedAt: 18,
    }),
    record({
      id: "pending-a",
      employmentProfileId: "ep-a",
      status: "PENDING_APPROVAL",
      approvedBy: null,
      approvedAt: null,
      effectiveFrom: Date.UTC(2026, 5, 1),
      effectiveTo: null,
      updatedAt: 19,
    }),
    record({
      id: "pending-ineligible",
      employmentProfileId: "ep-a",
      status: "PENDING_APPROVAL",
      payrollEligible: false,
      approvedBy: null,
      approvedAt: null,
      effectiveFrom: Date.UTC(2026, 5, 1),
      effectiveTo: null,
      updatedAt: 20,
    }),
    record({
      id: "missing-b",
      employmentProfileId: "ep-b",
      effectiveFrom: Date.UTC(2026, 0, 1),
      effectiveTo: null,
      baseSalaryAmount: -1,
      approvedAt: Date.UTC(2026, 0, 2),
    }),
    record({
      id: "ineligible-b",
      employmentProfileId: "ep-b",
      effectiveFrom: Date.UTC(2026, 0, 1),
      effectiveTo: null,
      payrollEligible: false,
      approvedAt: Date.UTC(2026, 0, 2),
    }),
    record({
      id: "expired-b",
      employmentProfileId: "ep-b",
      effectiveFrom: Date.UTC(2025, 0, 1),
      effectiveTo: Date.UTC(2025, 11, 31),
      approvedAt: Date.UTC(2025, 0, 2),
    }),
    record({
      id: "archived-profile",
      employmentProfileId: "ep-archived",
      effectiveFrom: Date.UTC(2026, 0, 1),
      effectiveTo: null,
      approvedAt: Date.UTC(2026, 0, 2),
    }),
  );
  const profileRepository = {
    async findById(id: string) {
      return profiles.get(id) ?? null;
    },
  } as EmploymentProfileRepository;
  const service = new EmploymentTermsAdminService(
    terms,
    new MemorySequence(),
    profileRepository,
    audit,
    new MemoryMutationBridge(terms),
    () => Date.UTC(2026, 5, 7, 10),
  );
  return { service, terms, profiles };
}

class MemoryTermsRepository implements EmploymentTermsRepository {
  readonly records: EmploymentTermsRecord[] = [];
  private readonly approvalLocks = new Map<string, Promise<void>>();
  private readonly sessionLockReleases = new Map<ClientSession, (() => void)[]>();

  constructor(private readonly profiles: ReadonlyMap<string, EmploymentProfileRecord> = new Map()) {}

  async acquireApprovalLock(employmentProfileId: string, sessionValue: ClientSession): Promise<void> {
    const previous = this.approvalLocks.get(employmentProfileId) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => held);
    this.approvalLocks.set(employmentProfileId, queued);
    await previous;
    const releases = this.sessionLockReleases.get(sessionValue) ?? [];
    releases.push(() => {
      release();
      if (this.approvalLocks.get(employmentProfileId) === queued) {
        this.approvalLocks.delete(employmentProfileId);
      }
    });
    this.sessionLockReleases.set(sessionValue, releases);
  }
  releaseApprovalLocks(sessionValue: ClientSession): void {
    for (const release of this.sessionLockReleases.get(sessionValue) ?? []) release();
    this.sessionLockReleases.delete(sessionValue);
  }
  async insert(record: EmploymentTermsRecord): Promise<EmploymentTermsRecord> {
    this.records.push(record);
    return record;
  }
  async findById(id: string): Promise<EmploymentTermsRecord | null> {
    return this.records.find((item) => item.id === id) ?? null;
  }
  async listByEmploymentProfileId(id: string): Promise<readonly EmploymentTermsRecord[]> {
    return this.records.filter((item) => item.employmentProfileId === id);
  }
  async updateDraft(input: UpdateEmploymentTermsDraftInput): Promise<EmploymentTermsRecord | null> {
    return this.update(input.id, (current) =>
      current.status === "DRAFT"
        ? { ...current, ...input, id: current.id, status: current.status, version: current.version + 1 }
        : null,
    );
  }
  async transition(input: TransitionEmploymentTermsInput): Promise<EmploymentTermsRecord | null> {
    return this.update(input.id, (current) =>
      input.fromStatuses.includes(current.status)
        ? { ...current, ...input, id: current.id, status: input.toStatus, version: current.version + 1 }
        : null,
    );
  }
  async findOverlappingApprovedPayrollReadable(
    employmentProfileId: string,
    effectiveFrom: number,
    effectiveTo: number | null,
    excludeId?: string,
  ): Promise<EmploymentTermsRecord | null> {
    return this.records.find((item) =>
      item.id !== excludeId
      && item.employmentProfileId === employmentProfileId
      && item.status === "APPROVED"
      && item.payrollEligible
      && item.effectiveFrom <= (effectiveTo ?? Number.MAX_SAFE_INTEGER)
      && (item.effectiveTo === null || item.effectiveTo >= effectiveFrom),
    ) ?? null;
  }
  async findPayrollReadableForDate(id: string, date: number): Promise<readonly EmploymentTermsRecord[]> {
    return this.records.filter((item) =>
      item.employmentProfileId === id
      && item.status === "APPROVED"
      && item.payrollEligible
      && item.effectiveFrom <= date
      && (item.effectiveTo === null || item.effectiveTo >= date),
    );
  }
  async listAdminRecords(
    input: ListEmploymentTermsAdminRecordsInput,
  ): Promise<readonly EmploymentTermsAdminListRecord[]> {
    return this.records
      .map((terms) => {
        const currentProfile = this.profiles.get(terms.employmentProfileId);
        return currentProfile ? { terms, profile: currentProfile } : null;
      })
      .filter((item): item is { terms: EmploymentTermsRecord; profile: EmploymentProfileRecord } => item !== null)
      .filter(({ terms, profile: currentProfile }) =>
        (input.employmentProfileId === undefined || terms.employmentProfileId === input.employmentProfileId)
        && (input.status === undefined || terms.status === input.status)
        && (input.payrollEligible === undefined || terms.payrollEligible === input.payrollEligible)
        && (
          input.effectiveOn === undefined
          || (terms.effectiveFrom <= input.effectiveOn && (terms.effectiveTo === null || terms.effectiveTo >= input.effectiveOn))
        )
        && (
          input.expiringBefore === undefined
          || (terms.effectiveTo !== null && terms.effectiveTo <= input.expiringBefore)
        )
        && (
          input.employmentStatus === undefined
            ? currentProfile.employmentStatus !== "ARCHIVED"
            : currentProfile.employmentStatus === input.employmentStatus
        )
        && (input.orgUnitId === undefined || currentProfile.orgUnitId === input.orgUnitId)
        && (
          input.search === undefined
          || currentProfile.employeeCode.startsWith(input.search)
          || currentProfile.normalizedDisplayName.startsWith(input.search.toLowerCase())
          || currentProfile.normalizedLegalName.startsWith(input.search.toLowerCase())
        ),
      )
      .sort((left, right) =>
        left.profile.displayName.localeCompare(right.profile.displayName)
        || left.profile.employeeCode.localeCompare(right.profile.employeeCode)
        || right.terms.effectiveFrom - left.terms.effectiveFrom
        || right.terms.updatedAt - left.terms.updatedAt
        || left.terms.id.localeCompare(right.terms.id),
      )
      .map(({ terms, profile: currentProfile }) => ({
        terms,
        employmentProfile: {
          id: currentProfile.id,
          employeeCode: currentProfile.employeeCode,
          displayName: currentProfile.displayName,
          legalName: currentProfile.legalName,
          employmentStatus: currentProfile.employmentStatus,
          orgUnitId: currentProfile.orgUnitId,
          orgUnitRef: {
            id: currentProfile.orgUnitId,
            code: currentProfile.orgUnitId.toUpperCase(),
            name: currentProfile.orgUnitId,
            status: "ACTIVE",
          },
        },
      }));
  }
  async listOverlapContextByEmploymentProfileIds(
    employmentProfileIds: readonly string[],
  ): Promise<readonly EmploymentTermsOverlapContextRecord[]> {
    return this.records.filter((item) =>
      employmentProfileIds.includes(item.employmentProfileId)
      && item.status === "APPROVED"
      && item.payrollEligible,
    );
  }
  async findMaxGeneratedCodeSequence(_policy: Pick<BusinessCodePolicy, "prefix" | "width">): Promise<number> {
    return 0;
  }
  private update(
    id: string,
    fn: (current: EmploymentTermsRecord) => EmploymentTermsRecord | null,
  ): EmploymentTermsRecord | null {
    const index = this.records.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const updated = fn(this.records[index]!);
    if (updated) this.records[index] = updated;
    return updated;
  }
}

class MemoryMutationBridge implements AuthoritativeAdminMutationBridge {
  constructor(private readonly repository: MemoryTermsRepository) {}

  async execute<T>(
    _params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    mutate: (session: ClientSession, controls: AuthoritativeMutationControls) => Promise<T>,
  ): Promise<T> {
    const sessionValue = {} as ClientSession;
    const controls: AuthoritativeMutationControls = {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    };
    try {
      return await mutate(sessionValue, controls);
    } finally {
      this.repository.releaseApprovalLocks(sessionValue);
    }
  }
}

class MemorySequence implements BusinessCodeSequenceRepository {
  private value = 0;
  async allocateNext(): Promise<number> {
    return ++this.value;
  }
  async ensureAtLeast(_module: string, _bucket: string, minimum: number): Promise<void> {
    this.value = Math.max(this.value, minimum);
  }
}

function validCreate() {
  return {
    employmentProfileId: "ep-1",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    baseSalaryAmount: 10_000_000,
    currencyCode: "VND",
    payFrequency: "MONTHLY",
    payrollEligible: true,
    sourceNote: "Approved external HR decision",
    allowances: [
      {
        type: "MEAL",
        label: "Meal allowance",
        amount: 500_000,
        currencyCode: "VND",
        payrollEligible: true,
        effectiveFrom: null,
        effectiveTo: null,
        sourceNote: null,
      },
    ],
  };
}

function actor(id: string, permissions: readonly Permission[]): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {},
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function permissionDenied(error: unknown): boolean {
  assert.ok(error instanceof SystemInvariantError);
  assert.equal(error.code, "PERMISSION_DENIED");
  return true;
}

function record(patch: Partial<EmploymentTermsRecord> = {}): EmploymentTermsRecord {
  return {
    id: "approved",
    termsCode: "ET-2026-000001",
    employmentProfileId: "ep-1",
    status: "APPROVED",
    effectiveFrom: Date.UTC(2026, 0, 1),
    effectiveTo: Date.UTC(2026, 11, 31),
    baseSalaryAmount: 10_000_000,
    currencyCode: "VND",
    payFrequency: "MONTHLY",
    allowances: [],
    payrollEligible: true,
    sourceNote: null,
    createdBy: "maker",
    createdAt: 1,
    updatedBy: "checker",
    updatedAt: 1,
    submittedBy: "maker",
    submittedAt: 1,
    approvedBy: "checker",
    approvedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    supersedesTermsId: null,
    supersededByTermsId: null,
    version: 1,
    ...patch,
  };
}

function allowance(patch: Partial<EmploymentTermsAllowance> = {}): EmploymentTermsAllowance {
  return {
    type: "MEAL",
    label: "Meal allowance",
    amount: 500_000,
    currencyCode: "VND",
    payrollEligible: true,
    effectiveFrom: null,
    effectiveTo: null,
    sourceNote: null,
    ...patch,
  };
}

function profile(
  id: string,
  status: EmploymentProfileRecord["employmentStatus"],
  patch: Partial<EmploymentProfileRecord> = {},
): EmploymentProfileRecord {
  return {
    id,
    employeeCode: id,
    legalName: id,
    normalizedLegalName: id,
    displayName: id,
    normalizedDisplayName: id,
    employmentKind: "EMPLOYEE",
    jobTitle: "Staff",
    titleDescription: null,
    externalRef: null,
    orgUnitId: "org",
    managerEmploymentProfileId: null,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: null,
    employmentStatus: status,
    contractStatus: status === "ARCHIVED" ? "TERMINATED" : "ACTIVE",
    employmentStartDate: 1,
    employmentEndDate: status === "ARCHIVED" ? 2 : null,
    hiredAt: null,
    onboardedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

class TestableEmploymentTermsController extends EmploymentTermsAdminController {
  async dispatch(req: Request, actorValue: Actor): Promise<unknown> {
    return this.present(await this.handle(req, actorValue, "ADMIN"));
  }
}
