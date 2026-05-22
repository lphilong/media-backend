import { ContextType } from "@core/context/context.types";
import {
  ResolvedActorUser,
  UserAccountStatus,
  UserActorKind,
  UserDetailView,
  UserListItemView,
  UserRecord,
} from "@modules/user/domain/user.types";

export interface CreateUserCommand {
  readonly actorKind?: UserActorKind;
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly locale?: string;
  readonly timezone?: string;
}

export interface ProvisionUserCommand {
  readonly actorKind?: UserActorKind;
  readonly displayName: string;
  readonly email: string;
  readonly phone?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly credentialMode?: "INVITE_LINK";
  readonly sendInvitation?: boolean;
}

export interface UpdateUserCommand {
  readonly userId: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly locale?: string;
  readonly timezone?: string;
}

export interface ActivateUserCommand {
  readonly userId: string;
}

export interface DisableUserCommand {
  readonly userId: string;
}

export interface ArchiveUserCommand {
  readonly userId: string;
}

export interface SetAuthLinkageCommand {
  readonly userId: string;
  readonly provider: "auth0";
  readonly subject: string;
}

export interface UnlinkAuthLinkageCommand {
  readonly userId: string;
}

export interface SendPasswordSetupCommand {
  readonly userId: string;
}

export interface GetUserDetailQuery {
  readonly userId: string;
}

export interface ListUsersQuery {
  readonly state?: UserAccountStatus | string;
  readonly actorKind?: UserActorKind | string;
  readonly cursor?: string;
  readonly limit?: number | string;
  readonly search?: string;
}

export interface UserMutationResult {
  readonly user: UserRecord;
  readonly provisioning?: {
    readonly credentialMode: "INVITE_LINK";
    readonly auth0UserCreated: boolean;
    readonly invitationTicketCreated: boolean;
  };
  readonly passwordSetup?: {
    readonly ticketCreated: boolean;
  };
}

export type UserDetailResult = UserDetailView;

export interface UserListResult {
  readonly items: readonly UserListItemView[];
  readonly nextCursor?: string;
}

export interface ResolveActorByAuthLinkageInput {
  readonly context: ContextType;
  readonly authSubject: string;
}

export interface ResolveActorByAuthLinkageResult {
  readonly actor: ResolvedActorUser;
}
