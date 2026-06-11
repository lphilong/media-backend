import { EmploymentTermsReadinessFacts } from "./employment-terms-readiness";

export interface EmploymentTermsReadinessReadonlyAccess {
  getReadinessFacts(
    employmentProfileIds: readonly string[],
    asOfDate: number,
  ): Promise<ReadonlyMap<string, EmploymentTermsReadinessFacts>>;
}
