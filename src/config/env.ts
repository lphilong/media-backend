import "dotenv/config";
import { z } from "zod";

/**
 * Runtime mode selector.
 * Used by server.ts to decide HTTP vs SYSTEM bootstrap.
 */
export const RuntimeSchema = z.enum(["http", "system"]);

const KNOWN_ENV_KEYS = [
  "APP_NAME",
  "NODE_ENV",
  "APP_RUNTIME",
  "PORT",
  "HTTP_BIND_HOST",
  "HTTP_MANAGEMENT_ENABLED",
  "HTTP_MANAGEMENT_HOST",
  "HTTP_MANAGEMENT_PORT",
  "HTTP_ERROR_INCLUDE_REQUEST_ID",
  "ADMIN_BUSINESS_TIMEZONE",
  "TRUST_PROXY",
  "CORS_ORIGINS",
  "MONGO_URI",
  "MONGO_DB_NAME",
  "MONGO_MAX_POOL_SIZE",
  "REDIS_URL",
  "QUEUE_BACKLOG_THRESHOLD",
  "WORKER_CRASH_WINDOW_MS",
  "WORKER_CRASH_THRESHOLD",
  "SYSTEM_METRICS_PORT",
  "AUTH0_ISSUER_BASE_URL",
  "AUTH0_AUDIENCE",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_NAMESPACE",
  "ENCRYPTION_KEY",
  "LOG_LEVEL",
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "STORAGE_BASE_URL",
  "STORAGE_UPLOAD_TTL",
  "STORAGE_DOWNLOAD_TTL",
] as const;

type KnownEnvKey = (typeof KNOWN_ENV_KEYS)[number];

function parseBooleanFlag(
  input: string | undefined,
  defaultValue: boolean,
): boolean {
  if (input === undefined) {
    return defaultValue;
  }

  const normalized = input.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(
    `Boolean env flag must be "true" or "false". Received: ${input}`,
  );
}

function isValidIanaTimeZone(
  value: string,
): boolean {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).format(new Date(0));

    return true;
  } catch {
    return false;
  }
}

function readKnownEnv(
  source: NodeJS.ProcessEnv,
): Record<KnownEnvKey, string | undefined> {
  const result = {} as Record<
    KnownEnvKey,
    string | undefined
  >;

  for (const key of KNOWN_ENV_KEYS) {
    result[key] = source[key];
  }

  return result;
}

const envSchema = z
  .object({
    /* =========================
     * APP
     * ========================= */
    APP_NAME: z.string().min(1).default("cms"),

    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    /**
     * Explicit runtime selector.
     * - http   → Express server
     * - system → workers / cron / async jobs
     */
    APP_RUNTIME: RuntimeSchema,

    PORT: z.coerce.number().int().positive().default(7000),
    HTTP_BIND_HOST: z
      .string()
      .trim()
      .min(1)
      .default("127.0.0.1"),
    HTTP_MANAGEMENT_ENABLED: z
      .string()
      .optional()
      .transform((value, ctx) => {
        try {
          return parseBooleanFlag(value, false);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              error instanceof Error
                ? error.message
                : "Invalid HTTP_MANAGEMENT_ENABLED value",
          });
          return z.NEVER;
        }
      }),
    HTTP_MANAGEMENT_HOST: z
      .string()
      .trim()
      .min(1)
      .optional(),
    HTTP_MANAGEMENT_PORT: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    HTTP_ERROR_INCLUDE_REQUEST_ID: z
      .string()
      .optional()
      .transform((value, ctx) => {
        try {
          return parseBooleanFlag(value, false);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              error instanceof Error
                ? error.message
                : "Invalid HTTP_ERROR_INCLUDE_REQUEST_ID value",
          });
          return z.NEVER;
        }
      }),
    ADMIN_BUSINESS_TIMEZONE: z
      .string()
      .trim()
      .min(1)
      .refine(isValidIanaTimeZone, {
        message:
          "ADMIN_BUSINESS_TIMEZONE must be a valid IANA timezone",
      })
      .default("UTC"),

    /* =========================
     * HTTP / NETWORK
     * ========================= */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    CORS_ORIGINS: z
      .string()
      .optional()
      .transform((val) =>
        val
          ? val
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      ),

    /* =========================
     * DATABASE
     * ========================= */
    MONGO_URI: z.string().refine(
      (val) =>
        val.startsWith("mongodb://") ||
        val.startsWith("mongodb+srv://"),
      {
        message:
          "MONGO_URI must start with mongodb:// or mongodb+srv://",
      },
    ),

    MONGO_DB_NAME: z.string().min(1),

    MONGO_MAX_POOL_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .default(200),

    REDIS_URL: z.string().url(),

    /* =========================
     * QUEUE / RESILIENCE
     * ========================= */
    QUEUE_BACKLOG_THRESHOLD: z.coerce
      .number()
      .int()
      .positive()
      .default(500),

    WORKER_CRASH_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 60 * 1000),

    WORKER_CRASH_THRESHOLD: z.coerce
      .number()
      .int()
      .positive()
      .default(3),

    SYSTEM_METRICS_PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(9464),

    /* =========================
     * AUTH0
     * ========================= */
    AUTH0_ISSUER_BASE_URL: z.string().url().optional(),
    AUTH0_AUDIENCE: z.string().min(1).optional(),

    AUTH0_CLIENT_ID: z.string().min(1).optional(),
    AUTH0_CLIENT_SECRET: z.string().min(1).optional(),

    AUTH0_NAMESPACE: z.string().url().optional(),

    /* =========================
     * SECURITY
     * ========================= */
    ENCRYPTION_KEY: z
      .string()
      .length(
        64,
        "ENCRYPTION_KEY must be 64 hex characters",
      )
      .regex(
        /^[0-9a-fA-F]{64}$/,
        "ENCRYPTION_KEY must be hexadecimal",
      )
      .optional(),

    /* =========================
     * LOGGING
     * ========================= */
    LOG_LEVEL: z
      .enum(["error", "warn", "info", "debug"])
      .default("info"),

    /* =========================
     * STORAGE
     * ========================= */
    STORAGE_PROVIDER: z
      .enum(["s3", "local"])
      .default("local"),

    STORAGE_BUCKET: z.string().optional(),

    STORAGE_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),

    STORAGE_BASE_URL: z.string().url().optional(),

    STORAGE_UPLOAD_TTL: z.coerce
      .number()
      .int()
      .positive()
      .default(300),

    STORAGE_DOWNLOAD_TTL: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
  })
  .superRefine((env, ctx) => {
    if (env.APP_RUNTIME === "http") {
      if (!env.AUTH0_ISSUER_BASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH0_ISSUER_BASE_URL"],
          message:
            "AUTH0_ISSUER_BASE_URL is required when APP_RUNTIME=http",
        });
      }

      if (!env.AUTH0_AUDIENCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH0_AUDIENCE"],
          message:
            "AUTH0_AUDIENCE is required when APP_RUNTIME=http",
        });
      }

      if (!env.HTTP_BIND_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["HTTP_BIND_HOST"],
          message:
            "HTTP_BIND_HOST is required when APP_RUNTIME=http",
        });
      }

      if (env.HTTP_MANAGEMENT_ENABLED) {
        if (!env.HTTP_MANAGEMENT_HOST) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["HTTP_MANAGEMENT_HOST"],
            message:
              "HTTP_MANAGEMENT_HOST is required when HTTP_MANAGEMENT_ENABLED=true",
          });
        }

        if (!env.HTTP_MANAGEMENT_PORT) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["HTTP_MANAGEMENT_PORT"],
            message:
              "HTTP_MANAGEMENT_PORT is required when HTTP_MANAGEMENT_ENABLED=true",
          });
        }
      }
    }

    if (
      env.NODE_ENV === "production" &&
      env.STORAGE_PROVIDER === "local"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_PROVIDER"],
        message:
          "STORAGE_PROVIDER=local is forbidden when NODE_ENV=production",
      });
    }

    if (env.STORAGE_PROVIDER === "local") {
      if (!env.STORAGE_BASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["STORAGE_BASE_URL"],
          message:
            "STORAGE_BASE_URL is required when STORAGE_PROVIDER=local",
        });
      }

      return;
    }

    if (!env.STORAGE_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_BUCKET"],
        message:
          "STORAGE_BUCKET is required when STORAGE_PROVIDER=s3",
      });
    }

    if (!env.STORAGE_REGION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_REGION"],
        message:
          "STORAGE_REGION is required when STORAGE_PROVIDER=s3",
      });
    }
  })
  .strict();

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Readonly<Env> | null = null;

function parseEnv(
  source: NodeJS.ProcessEnv,
): Readonly<Env> {
  return Object.freeze(
    envSchema.parse(readKnownEnv(source)),
  );
}

export function getEnv(): Readonly<Env> {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = parseEnv(process.env);
  return cachedEnv;
}

export function readRuntimeFromProcessEnv(
  source: NodeJS.ProcessEnv = process.env,
): z.infer<typeof RuntimeSchema> | "unknown" {
  const parsed = RuntimeSchema.safeParse(
    source.APP_RUNTIME,
  );

  return parsed.success ? parsed.data : "unknown";
}

export function clearEnvCacheForTests(): void {
  cachedEnv = null;
}

export const env: Readonly<Env> = new Proxy(
  {},
  {
    get(_target, prop, receiver) {
      return Reflect.get(getEnv(), prop, receiver);
    },
    has(_target, prop) {
      return Reflect.has(getEnv(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(getEnv());
    },
    getOwnPropertyDescriptor(_target, prop) {
      const descriptor = Object.getOwnPropertyDescriptor(
        getEnv(),
        prop,
      );

      if (!descriptor) {
        return undefined;
      }

      return {
        ...descriptor,
        configurable: true,
      };
    },
  },
) as Readonly<Env>;
