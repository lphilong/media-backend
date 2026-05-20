import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InsufficientScopeError,
  InvalidRequestError,
  InvalidTokenError,
  UnauthorizedError,
} from "express-oauth2-jwt-bearer";
import { mapToHttpError } from "./http-error.map";
import { createHttpErrorResponse } from "./http-error-response.contract";
import { OrgUnitConflictError } from "@modules/org-unit/domain/org-unit.errors";
import { ValidationError } from "@core/errors/validation.error";

function assertMappedError(
  err: unknown,
  expected: {
    readonly status: number;
    readonly code: string;
    readonly message: string;
  },
) {
  const mapped = mapToHttpError(err);
  const response = createHttpErrorResponse({
    error: mapped,
    includeRequestId: false,
  });

  assert.equal(mapped.status, expected.status);
  assert.equal(mapped.code, expected.code);
  assert.equal(mapped.message, expected.message);
  assert.deepEqual(response, {
    error: {
      code: expected.code,
      message: expected.message,
    },
  });
  assert.equal(response.error.message.includes("Bearer"), false);
  assert.equal(response.error.message.includes("raw-token"), false);
  assert.equal(response.error.message.includes("secret"), false);
  assert.equal(response.error.message.includes(" at "), false);
}

test("maps UnauthorizedError-shaped Auth0 bearer errors to canonical 401", () => {
  assertMappedError(
    {
      name: "UnauthorizedError",
      status: 401,
      statusCode: 401,
      message: "Bearer raw-token secret",
      stack: "Error: Bearer raw-token secret\n at auth",
    },
    {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid authentication",
    },
  );
});

test("maps InvalidTokenError-shaped Auth0 bearer errors to canonical 401", () => {
  assertMappedError(
    {
      name: "InvalidTokenError",
      code: "invalid_token",
      status: 401,
      statusCode: 401,
      message: "jwt malformed raw-token secret",
    },
    {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid authentication",
    },
  );
});

test("maps InsufficientScopeError-shaped Auth0 bearer errors to canonical 403", () => {
  assertMappedError(
    {
      name: "InsufficientScopeError",
      code: "insufficient_scope",
      status: 403,
      statusCode: 403,
      message: "missing scope admin:read raw-token",
    },
    {
      status: 403,
      code: "FORBIDDEN",
      message: "Permission denied",
    },
  );
});

test("maps InvalidRequestError-shaped Auth0 bearer errors to canonical 400", () => {
  assertMappedError(
    {
      name: "InvalidRequestError",
      code: "invalid_request",
      status: 400,
      statusCode: 400,
      message: "More than one method used for authentication raw-token",
    },
    {
      status: 400,
      code: "BAD_REQUEST",
      message: "Invalid authentication request",
    },
  );
});

test("maps exported express-oauth2-jwt-bearer classes without leaking raw messages", () => {
  assertMappedError(new UnauthorizedError("raw-token secret"), {
    status: 401,
    code: "UNAUTHORIZED",
    message: "Invalid authentication",
  });
  assertMappedError(new InvalidTokenError("raw-token secret"), {
    status: 401,
    code: "UNAUTHORIZED",
    message: "Invalid authentication",
  });
  assertMappedError(new InsufficientScopeError(["admin:read"]), {
    status: 403,
    code: "FORBIDDEN",
    message: "Permission denied",
  });
  assertMappedError(new InvalidRequestError("raw-token secret"), {
    status: 400,
    code: "BAD_REQUEST",
    message: "Invalid authentication request",
  });
});

test("keeps unknown generic errors mapped to canonical 500", () => {
  assertMappedError(new Error("raw-token secret"), {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Unexpected error",
  });
});

test("preserves existing domain and application error mappings", () => {
  assertMappedError(new ValidationError("raw-token secret"), {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Invalid input",
  });
  assertMappedError(
    new OrgUnitConflictError("raw-token secret"),
    {
      status: 409,
      code: "ORG_UNIT_CONFLICT_ERROR",
      message: "Org unit conflict",
    },
  );
});
