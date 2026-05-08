import { Queue, QueueOptions } from "bullmq";
import { Redis } from "ioredis";

export function createQueue(
  name: string,
  redis: Redis,
): Queue {
  const options: QueueOptions = {
    connection: redis,
  };

  return new Queue(name, options);
}
