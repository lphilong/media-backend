import {
  QueueName,
  BaseJobPayload,
  AdmissionOutcome,
  PublishOptions,
} from "./queue.types";

export interface QueueAdapter {
  publish<T extends BaseJobPayload>(
    queue: QueueName,
    jobName: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<AdmissionOutcome>;
}
