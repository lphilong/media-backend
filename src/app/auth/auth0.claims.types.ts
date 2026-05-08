export interface Auth0Claims {
  sub: string; // auth0|xxxx
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;

  email?: string;
}
