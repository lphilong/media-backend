import { Db } from "mongodb";
import { UserRepository } from "@infra/mongo/user/user.repository";
import { MongoUserAuthRepository } from "@infra/mongo/user/user.auth.repository";
import { MongoUserReadRepository } from "@infra/mongo/user/user.read-repository";

export interface UserInfra {
  readonly userRepository: UserRepository;
  readonly userReadRepository: MongoUserReadRepository;
  readonly userAuthRepository: MongoUserAuthRepository;
}

export function createUserInfra(db: Db): UserInfra {
  return {
    userRepository: new UserRepository(db),
    userReadRepository: new MongoUserReadRepository(db),
    userAuthRepository: new MongoUserAuthRepository(db),
  };
}
