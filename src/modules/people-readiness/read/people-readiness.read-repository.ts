import { PeopleReadinessSnapshot } from "../domain/people-readiness.types";

export interface PeopleReadinessReadRepository {
  getSnapshot(): Promise<PeopleReadinessSnapshot>;
}
