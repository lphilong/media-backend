import { ClientSession } from "mongodb";

export interface EmploymentProfileEventAssignmentReadonlyAccess {
  hasLiveEventBindingForEmploymentProfile(
    employmentProfileId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
