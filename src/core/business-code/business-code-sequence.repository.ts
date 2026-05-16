import { ClientSession } from "mongodb";

export interface BusinessCodePolicy {
  readonly moduleKey: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly width: number;
}

export interface BusinessCodeSequenceRepository {
  allocateNext(
    moduleKey: string,
    bucket: string,
    session: ClientSession,
  ): Promise<number>;

  ensureAtLeast(
    moduleKey: string,
    bucket: string,
    minimumValue: number,
    session: ClientSession,
  ): Promise<void>;
}

export function formatBusinessCode(
  policy: BusinessCodePolicy,
  sequence: number,
): string {
  return `${policy.prefix}-${String(sequence).padStart(policy.width, "0")}`;
}

export function parseGeneratedBusinessCodeSequence(
  code: string,
  policy: Pick<BusinessCodePolicy, "prefix" | "width">,
): number | null {
  const match = new RegExp(
    `^${escapeRegExp(policy.prefix)}-(\\d{${policy.width}})$`,
    "u",
  ).exec(code);

  if (!match) {
    return null;
  }

  const sequence = Number(match[1]);

  return Number.isSafeInteger(sequence) ? sequence : null;
}

export function buildGeneratedBusinessCodeRegex(
  policy: Pick<BusinessCodePolicy, "prefix" | "width">,
): RegExp {
  return new RegExp(
    `^${escapeRegExp(policy.prefix)}-\\d{${policy.width}}$`,
    "u",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
