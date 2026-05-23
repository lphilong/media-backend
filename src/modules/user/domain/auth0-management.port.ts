export interface Auth0ManagementUser {
  readonly id: string;
  readonly email: string;
}

export interface Auth0CreateDatabaseUserInput {
  readonly email: string;
  readonly displayName: string;
  readonly connection: string;
  readonly password: string;
  readonly verifyEmail: boolean;
}

export interface Auth0PasswordChangeTicketInput {
  readonly userId: string;
  readonly resultUrl?: string;
}

export interface Auth0PasswordResetEmailInput {
  readonly email: string;
  readonly connection: string;
  readonly clientId?: string;
}

export interface Auth0ManagementPort {
  findUserByEmail(email: string): Promise<Auth0ManagementUser | null>;

  getUserById(userId: string): Promise<Auth0ManagementUser | null>;

  createDatabaseUser(
    input: Auth0CreateDatabaseUserInput,
  ): Promise<Auth0ManagementUser>;

  createPasswordChangeTicket(
    input: Auth0PasswordChangeTicketInput,
  ): Promise<{ readonly ticketCreated: true; readonly ticketUrl?: string }>;

  sendPasswordResetEmail(
    input: Auth0PasswordResetEmailInput,
  ): Promise<void>;
}
