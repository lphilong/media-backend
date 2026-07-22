import crypto from "node:crypto";
import { RoleValidationError } from "@modules/role/domain/role.errors";

const VERSION = "v1";
const NONCE_BYTES = 12;

export interface AccessGovernanceCursorBinding {
  readonly actorId: string;
  readonly queue: string;
  readonly permission: string;
  readonly queryIdentity: string;
  readonly pageSize: number;
}

export interface AccessGovernanceSourcePosition {
  readonly value: number;
  readonly id: string;
}

interface CursorPayload extends AccessGovernanceSourcePosition {
  readonly expiresAt: number;
}

export class AccessGovernanceQueueCursorCodec {
  constructor(
    private readonly key: Buffer,
    private readonly ttlMs: number = 15 * 60 * 1000,
  ) {
    if (key.length !== 32) {
      throw new RoleValidationError("GOVERNANCE_CURSOR_KEY_MUST_BE_32_BYTES");
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 24 * 60 * 60 * 1000) {
      throw new RoleValidationError("GOVERNANCE_CURSOR_TTL_INVALID");
    }
  }

  seal(
    position: AccessGovernanceSourcePosition,
    binding: AccessGovernanceCursorBinding,
    now: number = Date.now(),
  ): string {
    validatePosition(position);
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(bindingBytes(binding));
    const plaintext = Buffer.from(
      JSON.stringify({ ...position, expiresAt: now + this.ttlMs }),
      "utf8",
    );
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [
      VERSION,
      nonce.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  open(
    token: string,
    binding: AccessGovernanceCursorBinding,
    now: number = Date.now(),
  ): AccessGovernanceSourcePosition {
    try {
      const parts = token.split(".");
      if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("version");
      const nonce = decodeBase64UrlStrict(parts[1] ?? "");
      const encrypted = decodeBase64UrlStrict(parts[2] ?? "");
      const tag = decodeBase64UrlStrict(parts[3] ?? "");
      if (nonce.length !== NONCE_BYTES || encrypted.length === 0 || tag.length !== 16) {
        throw new Error("shape");
      }
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAAD(bindingBytes(binding));
      decipher.setAuthTag(tag);
      const payload = JSON.parse(
        Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"),
      ) as CursorPayload;
      validatePosition(payload);
      if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
        throw new Error("expired");
      }
      return Object.freeze({ value: payload.value, id: payload.id });
    } catch {
      throw new RoleValidationError("INVALID_QUEUE_CURSOR");
    }
  }
}

function decodeBase64UrlStrict(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("encoding");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("non-canonical-encoding");
  }
  return decoded;
}

export function createAccessGovernanceQueueCursorCodecFromEnvironment(): AccessGovernanceQueueCursorCodec {
  const encoded = process.env.ACCESS_GOVERNANCE_CURSOR_KEY;
  if (!encoded || !/^[0-9a-fA-F]{64}$/u.test(encoded)) {
    throw new RoleValidationError("ACCESS_GOVERNANCE_CURSOR_KEY_INVALID");
  }
  const ttl = process.env.ACCESS_GOVERNANCE_CURSOR_TTL_MS;
  const ttlMs = ttl === undefined ? 15 * 60 * 1000 : Number(ttl);
  return new AccessGovernanceQueueCursorCodec(Buffer.from(encoded, "hex"), ttlMs);
}

export function deriveAccessGovernanceCursorKey(masterHexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/u.test(masterHexKey)) {
    throw new RoleValidationError("ACCESS_GOVERNANCE_CURSOR_MASTER_KEY_INVALID");
  }
  return crypto
    .createHash("sha256")
    .update("title-media/access-governance-cursor/v1\0", "utf8")
    .update(Buffer.from(masterHexKey, "hex"))
    .digest();
}

function bindingBytes(binding: AccessGovernanceCursorBinding): Buffer {
  if (
    !binding.actorId ||
    !binding.queue ||
    !binding.permission ||
    !binding.queryIdentity ||
    !Number.isInteger(binding.pageSize)
  ) {
    throw new RoleValidationError("GOVERNANCE_CURSOR_BINDING_INVALID");
  }
  return Buffer.from(
    JSON.stringify([
      VERSION,
      binding.actorId,
      binding.queue,
      binding.permission,
      binding.queryIdentity,
      binding.pageSize,
    ]),
    "utf8",
  );
}

function validatePosition(value: AccessGovernanceSourcePosition): void {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.value !== "number" ||
    !Number.isFinite(value.value) ||
    typeof value.id !== "string" ||
    !value.id
  ) {
    throw new RoleValidationError("INVALID_QUEUE_CURSOR");
  }
}
