import { ReferenceSummary } from "@modules/reference-summary";
import { TalentOrigin } from "./talent.types";

export interface TalentDisplayInput {
  readonly talentCode: string;
  readonly stageName?: string | null;
  readonly legalName?: string | null;
  readonly displayShortName?: string | null;
  readonly talentOrigin: TalentOrigin;
}

export interface TalentDisplaySummary {
  readonly displayName: string;
  readonly performanceAlias: string | null;
}

export interface TalentDisplayEmploymentProfile {
  readonly displayName?: string | null;
  readonly legalName?: string | null;
  readonly name?: string | null;
}

export function deriveTalentDisplaySummary(
  talent: TalentDisplayInput,
  linkedEmploymentProfile?: TalentDisplayEmploymentProfile | ReferenceSummary | null,
): TalentDisplaySummary {
  const stageName = readText(talent.stageName);
  const legalName = readText(talent.legalName);
  const displayShortName = readText(talent.displayShortName);

  if (talent.talentOrigin === "INTERNAL") {
    const employmentProfileDisplayName =
      readText(linkedEmploymentProfile?.displayName) ??
      readText(linkedEmploymentProfile?.name);
    const displayName =
      employmentProfileDisplayName ??
      displayShortName ??
      stageName ??
      legalName ??
      talent.talentCode;

    return {
      displayName,
      performanceAlias:
        stageName && stageName !== displayName ? stageName : null,
    };
  }

  return {
    displayName:
      displayShortName ??
      stageName ??
      legalName ??
      talent.talentCode,
    performanceAlias: stageName ?? null,
  };
}

function readText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
