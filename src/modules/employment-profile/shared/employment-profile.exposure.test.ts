import assert from "node:assert/strict";
import test from "node:test";

import {
  EmploymentProfileAdminDetailExposure,
  EmploymentProfileAdminListExposure,
  EmploymentProfileAdminMutationExposure,
} from "@modules/employment-profile/shared/employment-profile.exposure";

const baseEmploymentProfileView = {
  id: "ep-1",
  employeeCode: "EP-001",
  legalName: "Pat Profile",
  displayName: "Pat Profile",
  employmentKind: "EMPLOYEE",
  jobTitle: "Producer",
  titleDescription: null,
  externalRef: null,
  orgUnitId: "org-1",
  orgUnitRef: { id: "org-1", label: "Studio" },
  recruiterEmploymentProfileId: null,
  recruiterEmploymentProfileRef: null,
  hrOwnerEmploymentProfileId: null,
  hrOwnerEmploymentProfileRef: null,
  onboardingOwnerEmploymentProfileId: null,
  onboardingOwnerEmploymentProfileRef: null,
  sourcedByEmploymentProfileId: null,
  sourcedByEmploymentProfileRef: null,
  linkedUserId: "user-1",
  linkedUserRef: { id: "user-1", label: "pat@example.test" },
  employmentStatus: "ACTIVE",
  contractStatus: "ACTIVE",
  employmentStartDate: "2026-01-01",
  employmentEndDate: null,
  hiredAt: "2026-01-01T00:00:00.000Z",
  onboardedAt: "2026-01-02T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  managerEmploymentProfileId: "legacy-manager",
  managerEmploymentProfileRef: {
    id: "legacy-manager",
    label: "Legacy Manager",
  },
};

test("EmploymentProfile admin exposure omits legacy manager source fields", () => {
  const list = EmploymentProfileAdminListExposure.expose(
    baseEmploymentProfileView as never,
  );
  const detail =
    EmploymentProfileAdminDetailExposure.expose(
      baseEmploymentProfileView as never,
    );
  const mutation =
    EmploymentProfileAdminMutationExposure.expose(
      baseEmploymentProfileView as never,
    );

  for (const exposed of [list, detail, mutation]) {
    assert.equal(
      "managerEmploymentProfileId" in exposed,
      false,
    );
    assert.equal(
      "managerEmploymentProfileRef" in exposed,
      false,
    );
  }
});
