export type LogLevel =
  | "info"
  | "warn"
  | "error"
  | "fatal";

export interface LogEvent {
  readonly traceId: string;
  readonly actorId: string;
  readonly context: string;
  readonly operation: string;
  readonly status: string;
  readonly timestamp: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StructuredLogger {
  info(event: LogEvent): void;
  warn(event: LogEvent): void;
  error(event: LogEvent): void;
  fatal(event: LogEvent): void;
}

function writeLine(stream: NodeJS.WriteStream, payload: string): void {
  stream.write(`${payload}\n`);
}

function sanitizeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!metadata) {
    return undefined;
  }

  return Object.freeze({ ...metadata });
}

class JsonStructuredLogger implements StructuredLogger {
  log(level: LogLevel, event: LogEvent): void {
    const record = {
      level,
      traceId: event.traceId,
      actorId: event.actorId,
      context: event.context,
      operation: event.operation,
      status: event.status,
      timestamp: event.timestamp,
      metadata: sanitizeMetadata(event.metadata),
    };

    const payload = JSON.stringify(record);

    if (level === "error" || level === "fatal") {
      writeLine(process.stderr, payload);
      return;
    }

    writeLine(process.stdout, payload);
  }

  info(event: LogEvent): void {
    this.log("info", event);
  }

  warn(event: LogEvent): void {
    this.log("warn", event);
  }

  error(event: LogEvent): void {
    this.log("error", event);
  }

  fatal(event: LogEvent): void {
    this.log("fatal", event);
  }
}

export function createStructuredLogger(): StructuredLogger {
  return Object.freeze(new JsonStructuredLogger());
}
