import assert from "node:assert/strict";
import test from "node:test";

import {
  TalentAdminDetailExposure,
  TalentAdminListExposure,
  TalentAdminMutationExposure,
} from "@modules/talent/shared/talent.exposure";

const baseTalentView = {
  id: "talent-1",
  talentCode: "TL-001",
  displayName: "Taylor Live",
  performanceAlias: null,
  stageName: null,
  legalName: null,
  displayShortName: "Taylor",
  talentOrigin: "INTERNAL_STAFF",
  operationalStatus: "ACTIVE",
  linkedEmploymentProfileId: "ep-1",
  linkedEmploymentProfileRef: {
    id: "ep-1",
    label: "Taylor Live",
  },
  commercialParticipationStatus: "ACTIVE",
  livestreamEligible: true,
  eventEligible: true,
  externalRef: null,
  profileSummary: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  managerEmploymentProfileId: "legacy-manager",
  managerEmploymentProfileRef: {
    id: "legacy-manager",
    label: "Legacy Manager",
  },
};

test("Talent admin exposure omits legacy manager source fields", () => {
  const list = TalentAdminListExposure.expose(
    baseTalentView as never,
  );
  const detail = TalentAdminDetailExposure.expose(
    baseTalentView as never,
  );
  const mutation = TalentAdminMutationExposure.expose(
    baseTalentView as never,
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
