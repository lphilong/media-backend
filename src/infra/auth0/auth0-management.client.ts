import axios, { AxiosInstance } from "axios";
import { env } from "@config/env";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import {
  Auth0CreateDatabaseUserInput,
  Auth0ManagementPort,
  Auth0ManagementUser,
  Auth0PasswordChangeTicketInput,
} from "@modules/user/domain/auth0-management.port";

export interface Auth0ManagementConfig {
  readonly domain: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly databaseConnection: string;
  readonly passwordSetupResultUrl?: string;
}

export function resolveAuth0ManagementConfigFromEnv():
  | Auth0ManagementConfig
  | null {
  const domain = env.AUTH0_MANAGEMENT_DOMAIN;
  const clientId = env.AUTH0_MANAGEMENT_CLIENT_ID;
  const clientSecret = env.AUTH0_MANAGEMENT_CLIENT_SECRET;
  const databaseConnection =
    env.AUTH0_DATABASE_CONNECTION;

  if (
    !domain ||
    !clientId ||
    !clientSecret ||
    !databaseConnection
  ) {
    return null;
  }

  return Object.freeze({
    domain,
    clientId,
    clientSecret,
    databaseConnection,
    passwordSetupResultUrl:
      env.AUTH0_PASSWORD_SETUP_RESULT_URL,
  });
}

export class DisabledAuth0ManagementClient
  implements Auth0ManagementPort
{
  async findUserByEmail(): Promise<null> {
    throw missingConfigError();
  }

  async getUserById(): Promise<null> {
    throw missingConfigError();
  }

  async createDatabaseUser(): Promise<Auth0ManagementUser> {
    throw missingConfigError();
  }

  async createPasswordChangeTicket(): Promise<{
    readonly ticketCreated: true;
  }> {
    throw missingConfigError();
  }
}

export class Auth0ManagementHttpClient
  implements Auth0ManagementPort
{
  private readonly http: AxiosInstance;
  private cachedToken:
    | {
        readonly value: string;
        readonly expiresAt: number;
      }
    | null = null;

  constructor(
    private readonly config: Auth0ManagementConfig,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: `https://${config.domain}`,
        timeout: 10_000,
      });
  }

  async findUserByEmail(
    email: string,
  ): Promise<Auth0ManagementUser | null> {
    const token = await this.getAccessToken();
    const response = await this.runHttpRequest(
      "find Auth0 user by email",
      () =>
        this.http.get<unknown>("/api/v2/users-by-email", {
          params: { email },
          headers: bearerHeaders(token),
        }),
    );

    const users = parseAuth0UserList(response.data);
    return users[0] ?? null;
  }

  async getUserById(
    userId: string,
  ): Promise<Auth0ManagementUser | null> {
    const token = await this.getAccessToken();

    try {
      const response = await this.http.get<unknown>(
        `/api/v2/users/${encodeURIComponent(userId)}`,
        {
          headers: bearerHeaders(token),
        },
      );

      return parseAuth0User(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }

      throw redactAuth0Error(error, "get Auth0 user");
    }
  }

  async createDatabaseUser(
    input: Auth0CreateDatabaseUserInput,
  ): Promise<Auth0ManagementUser> {
    const token = await this.getAccessToken();
    const response = await this.runHttpRequest(
      "create Auth0 database user",
      () =>
        this.http.post<unknown>(
          "/api/v2/users",
          {
            connection: input.connection,
            email: input.email,
            password: input.password,
            name: input.displayName,
            verify_email: input.verifyEmail,
          },
          {
            headers: bearerHeaders(token),
          },
        ),
    );

    return parseAuth0User(response.data);
  }

  async createPasswordChangeTicket(
    input: Auth0PasswordChangeTicketInput,
  ): Promise<{ readonly ticketCreated: true; readonly ticketUrl?: string }> {
    const token = await this.getAccessToken();
    const response = await this.runHttpRequest(
      "create Auth0 password-change ticket",
      () =>
        this.http.post<unknown>(
          "/api/v2/tickets/password-change",
          {
            user_id: input.userId,
            ...(input.resultUrl
              ? { result_url: input.resultUrl }
              : {}),
          },
          {
            headers: bearerHeaders(token),
          },
        ),
    );

    const ticketUrl = parseTicketUrl(response.data);
    return ticketUrl
      ? { ticketCreated: true, ticketUrl }
      : { ticketCreated: true };
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (
      this.cachedToken &&
      this.cachedToken.expiresAt > now + 30_000
    ) {
      return this.cachedToken.value;
    }

    const response = await this.runHttpRequest(
      "obtain Auth0 Management API token",
      () =>
        this.http.post<unknown>("/oauth/token", {
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          audience: `https://${this.config.domain}/api/v2/`,
        }),
    );

    const payload = parseTokenResponse(response.data);
    this.cachedToken = {
      value: payload.accessToken,
      expiresAt: now + payload.expiresIn * 1000,
    };

    return payload.accessToken;
  }

  private async runHttpRequest<T>(
    operation: string,
    request: () => Promise<T>,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw redactAuth0Error(error, operation);
    }
  }
}

function missingConfigError(): InfrastructureError {
  return new InfrastructureError(
    "AUTH0_MANAGEMENT_CONFIG_MISSING",
    "Auth0 Management API config is missing",
    "Auth0 Management API config is missing",
    409,
  );
}

function bearerHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function parseAuth0UserList(
  payload: unknown,
): readonly Auth0ManagementUser[] {
  if (!Array.isArray(payload)) {
    throw invalidPayloadError("Auth0 user list");
  }

  return payload.map(parseAuth0User);
}

function parseAuth0User(payload: unknown): Auth0ManagementUser {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw invalidPayloadError("Auth0 user");
  }

  const raw = payload as Record<string, unknown>;
  const id = raw.user_id;
  const email = raw.email;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw invalidPayloadError("Auth0 user id");
  }

  if (
    typeof email !== "string" ||
    email.trim().length === 0
  ) {
    throw invalidPayloadError("Auth0 user email");
  }

  return {
    id: id.trim(),
    email: email.trim().toLowerCase(),
  };
}

function parseTicketUrl(payload: unknown): string | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw invalidPayloadError("Auth0 password ticket");
  }

  const ticket = (payload as Record<string, unknown>).ticket;

  if (ticket === undefined) {
    return undefined;
  }

  if (
    typeof ticket !== "string" ||
    ticket.trim().length === 0
  ) {
    throw invalidPayloadError("Auth0 password ticket");
  }

  return ticket.trim();
}

function parseTokenResponse(payload: unknown): {
  readonly accessToken: string;
  readonly expiresIn: number;
} {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw invalidPayloadError("Auth0 token response");
  }

  const raw = payload as Record<string, unknown>;
  const accessToken = raw.access_token;
  const expiresIn = raw.expires_in;

  if (
    typeof accessToken !== "string" ||
    accessToken.trim().length === 0
  ) {
    throw invalidPayloadError("Auth0 token response");
  }

  if (
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw invalidPayloadError("Auth0 token expiry");
  }

  return {
    accessToken,
    expiresIn,
  };
}

function invalidPayloadError(label: string): InfrastructureError {
  return new InfrastructureError(
    "AUTH0_MANAGEMENT_INVALID_RESPONSE",
    `${label} response is invalid`,
    "Auth0 Management API response is invalid",
    502,
  );
}

function redactAuth0Error(
  error: unknown,
  operation: string,
): InfrastructureError {
  const status = axios.isAxiosError(error)
    ? error.response?.status
    : undefined;

  return new InfrastructureError(
    "AUTH0_MANAGEMENT_REQUEST_FAILED",
    `Failed to ${operation}${status ? `: HTTP ${status}` : ""}`,
    "Auth0 Management API request failed",
    502,
  );
}
